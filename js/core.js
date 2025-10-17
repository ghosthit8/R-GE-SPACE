// js/core.js
// Core primitives, network polling, and utilities.
// Consolidates all polling into a single guarded loop with backoff,
// restores a resilient Debug button, and prevents duplicate work.

//////////////////////////////
// Config & Clients
//////////////////////////////

export const SUPABASE_URL = "https://tuqvpcevrhciursxrgav.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs...CI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y";
export const EDGE_URL = `${SUPABASE_URL}/functions/v1/global-timer`;

// Supabase client (expecting UMD from your HTML)
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

//////////////////////////////
// DOM Refs (lazily resolved)
//////////////////////////////

const $ = (id) => document.getElementById(id);
const refs = new Proxy(
  {},
  {
    get: (_, k) => {
      const el = $(`${k}`);
      return el || null;
    },
  }
);

// If your HTML uses these IDs, they’ll resolve; if not, null is okay
// (we guard reads).
// Example expected ids from your UI: "clock", "loginBadge", etc.
// Add more as needed:
const clockEl = () => refs["clock"];
const loginBadgeEl = () => refs["loginBadge"];

//////////////////////////////
// Global State
//////////////////////////////

let paused = false;

let periodSec = 5; // base cadence for phase vote polling (can be tuned)
let serverPhaseEndISO = null;
let currentPhaseKey = null;
let prevPhaseKey = null;

let remainingSec = 0;
let lastSyncAt = 0;
let lastCountsAt = 0;

let currentUid = null;
let chosen = null;

// Debug state
const DEBUG_KEY = "core_debug";
let DEBUG = false;

//////////////////////////////
// Small Utilities
//////////////////////////////

const now = () => Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Abort + timeout for fetch
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(resource, { ...rest, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Jitter around a base interval so clients don’t sync-storm
const jitter = (baseMs, spreadRatio = 0.25) => {
  const spread = baseMs * spreadRatio;
  return baseMs + (Math.random() * 2 - 1) * spread;
};

// A simple once-only guard
function once(fn) {
  let done = false;
  return (...args) => {
    if (done) return;
    done = true;
    return fn(...args);
  };
}

// Cheap RAF ticker for the clock
function startClock() {
  let rafId = 0;
  const tick = () => {
    if (paused) return;
    const el = clockEl();
    if (el && remainingSec != null) {
      el.textContent = String(remainingSec);
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

//////////////////////////////
// Image Preloader (deduped)
//////////////////////////////

const imgCache = new Set();
export async function preloadImage(url) {
  if (!url || imgCache.has(url)) return;
  imgCache.add(url);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = url;
  });
}

//////////////////////////////
// Debug Button (resilient)
//////////////////////////////

function readDebugPref() {
  const qp = new URLSearchParams(location.search);
  if (qp.get("debug") === "1") return true;
  const stored = localStorage.getItem(DEBUG_KEY);
  return stored === "1";
}

function writeDebugPref(v) {
  localStorage.setItem(DEBUG_KEY, v ? "1" : "0");
}

function ensureDebugButton() {
  let btn = document.getElementById("debug-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "debug-btn";
    btn.style.position = "fixed";
    btn.style.right = "12px";
    btn.style.bottom = "12px";
    btn.style.zIndex = "99999";
    btn.style.padding = "8px 10px";
    btn.style.borderRadius = "10px";
    btn.style.border = "1px solid #ccc";
    btn.style.background = "#fff";
    btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    btn.style.fontFamily = "system-ui, sans-serif";
    btn.style.fontSize = "12px";
    btn.title = "Toggle debug overlay";
    document.body.appendChild(btn);
  }
  const label = (on) => (on ? "Debug: ON" : "Debug: OFF");
  btn.textContent = label(DEBUG);
  btn.onclick = () => {
    DEBUG = !DEBUG;
    writeDebugPref(DEBUG);
    btn.textContent = label(DEBUG);
    if (DEBUG) console.log("[DEBUG] enabled");
  };
}

//////////////////////////////
// Network: Consolidated Poller
//////////////////////////////

class Poller {
  constructor({
    votesEveryMs = 5000,
    edgeEveryMs = 5000,
    onCounts = () => {},
    winnersPhaseKeysProvider = () => [],
    onWinners = () => {},
    onPhaseChange = () => {},
  } = {}) {
    this.cfg = { votesEveryMs, edgeEveryMs };
    this._running = false;
    this._stop = null;

    // Backoff state
    this._votesBackoff = 0; // ms
    this._edgeBackoff = 0;

    // Hooks
    this._onCounts = onCounts;
    this._onWinners = onWinners;
    this._winnersKeys = winnersPhaseKeysProvider;
    this._onPhaseChange = onPhaseChange;

    // Dedup guards
    this._votesInflight = false;
    this._winnersInflight = false;
    this._edgeInflight = false;

    // Visibility handling
    this._handleVis = this._handleVis.bind(this);
  }

  start() {
    if (this._running) return;
    this._running = true;

    document.addEventListener("visibilitychange", this._handleVis, { passive: true });
    this._loop();
  }

  stop() {
    this._running = false;
    document.removeEventListener("visibilitychange", this._handleVis);
    if (this._stop) this._stop();
  }

  _handleVis() {
    if (document.hidden) {
      if (DEBUG) console.log("[POLL] hidden → pausing intensive polling");
    } else {
      if (DEBUG) console.log("[POLL] visible → bump an immediate pass");
      // Kick a pass without waiting for the next timer
      this._tick(true);
    }
  }

  async _loop() {
    const cancelClock = startClock();
    this._stop = once(() => cancelClock());

    while (this._running) {
      await this._tick(false);
      // Slow down when hidden
      const base = document.hidden ? Math.max(this.cfg.votesEveryMs, 10000) : this.cfg.votesEveryMs;
      await sleep(jitter(base));
    }
  }

  async _tick(force) {
    if (paused) return;

    // Phase votes counts
    if (!this._votesInflight) {
      this._votesInflight = true;
      this._pollVotes()
        .catch((e) => {
          if (DEBUG) console.warn("[POLL] votes error", e);
          this._votesBackoff = Math.min(30000, this._votesBackoff ? this._votesBackoff * 2 : 2000);
        })
        .finally(() => {
          this._votesInflight = false;
        });
    }

    // Winners for visible bracket nodes (batch)
    if (!this._winnersInflight) {
      const keys = this._winnersKeys();
      if (keys && keys.length) {
        this._winnersInflight = true;
        this._pollWinners(keys)
          .catch((e) => {
            if (DEBUG) console.warn("[POLL] winners error", e);
          })
          .finally(() => {
            this._winnersInflight = false;
          });
      }
    }

    // Edge timer ping (phase roll/clock sync)
    if (!this._edgeInflight && (force || !document.hidden)) {
      this._edgeInflight = true;
      this._pollEdge()
        .catch((e) => {
          if (DEBUG) console.warn("[POLL] edge error", e);
          this._edgeBackoff = Math.min(30000, this._edgeBackoff ? this._edgeBackoff * 2 : 2000);
        })
        .finally(() => {
          this._edgeInflight = false;
        });
    }
  }

  async _pollVotes() {
    const wait = this._votesBackoff || 0;
    if (wait) await sleep(wait);

    const url = `${SUPABASE_URL}/rest/v1/phase_votes?select=vote`;
    const res = await fetchWithTimeout(url, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error(`votes ${res.status}`);
    const data = await res.json();

    // Your UI logic can count tallies here or in onCounts:
    // e.g., const counts = tallyVotes(data);
    lastCountsAt = now();
    this._votesBackoff = 0;

    this._onCounts(data);
    if (DEBUG) console.log(`[NET] votes (${data.length}) @ ${new Date(lastCountsAt).toLocaleTimeString()}`);
  }

  async _pollWinners(phaseKeys) {
    // Batch by firing all, then mapping results back
    const headers = { apikey: SUPABASE_ANON_KEY };
    const fetches = phaseKeys.map((pk) =>
      fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/winners?select=color&phase_key=eq.${encodeURIComponent(pk)}`,
        { headers }
      ).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`winners ${r.status}`))))
    );

    const results = await Promise.allSettled(fetches);
    const map = new Map();
    results.forEach((r, i) => {
      const key = phaseKeys[i];
      if (r.status === "fulfilled") {
        map.set(key, r.value);
      } else if (DEBUG) {
        console.warn("[NET] winners fail for", key, r.reason);
      }
    });

    this._onWinners(map);
    if (DEBUG) console.log(`[NET] winners (${map.size}/${phaseKeys.length})`);
  }

  async _pollEdge() {
    const wait = this._edgeBackoff || 0;
    if (wait) await sleep(wait);

    const res = await fetchWithTimeout(EDGE_URL, { timeout: 6000 });
    if (!res.ok) throw new Error(`edge ${res.status}`);
    const payload = await res.json();

    // Expecting shape like: { phase: "...ISO...", serverNow: "...ISO...", periodSec: n }
    const { phase, serverNow, period } = normalizeEdgePayload(payload);
    const prev = currentPhaseKey;

    if (period && Number.isFinite(period)) {
      periodSec = Math.max(2, Math.min(30, period)); // clamp
    }

    if (phase && phase !== currentPhaseKey) {
      prevPhaseKey = currentPhaseKey;
      currentPhaseKey = phase;
      this._onPhaseChange({ prev: prevPhaseKey, next: currentPhaseKey });
      if (DEBUG) console.log("[STAGE] phaseKey →", currentPhaseKey);
    }

    // update clock-ish
    const serverT = serverNow ? Date.parse(serverNow) : now();
    const endGuess = serverT + periodSec * 1000;
    serverPhaseEndISO = new Date(endGuess).toISOString();
    remainingSec = Math.max(0, Math.round((endGuess - now()) / 1000));

    lastSyncAt = now();
    this._edgeBackoff = 0;
  }
}

function normalizeEdgePayload(p) {
  try {
    // Accept both your current format and a safe fallback
    const phase = p?.phase ?? p?.phaseKey ?? null;
    const serverNow = p?.serverNow ?? p?.now ?? new Date().toISOString();
    const period = Number.isFinite(p?.periodSec) ? p.periodSec : Number(p?.period) || null;
    return { phase, serverNow, period };
  } catch {
    return { phase: null, serverNow: new Date().toISOString(), period: null };
  }
}

//////////////////////////////
// Public API
//////////////////////////////

let singletonPoller = null;

/**
 * Initialize the core and start polling once.
 * @param {object} opts
 * @param {number} opts.votesEveryMs - cadence for phase_votes polling
 * @param {number} opts.edgeEveryMs - cadence for edge heartbeat (handled in loop; we use same tick)
 * @param {() => string[]} opts.winnersPhaseKeysProvider - return list of phase_keys we should ask winners for
 * @param {(counts:Array) => void} opts.onCounts
 * @param {(winnerMap: Map<string,Array>) => void} opts.onWinners
 * @param {(info:{prev:string|null,next:string|null}) => void} opts.onPhaseChange
 */
export function initCore(opts = {}) {
  // Restore / ensure debug button
  DEBUG = readDebugPref();
  ensureDebugButton();

  if (!singletonPoller) {
    singletonPoller = new Poller({
      votesEveryMs: Number.isFinite(opts.votesEveryMs) ? opts.votesEveryMs : 5000,
      edgeEveryMs: Number.isFinite(opts.edgeEveryMs) ? opts.edgeEveryMs : 5000,
      onCounts: opts.onCounts || (() => {}),
      winnersPhaseKeysProvider: opts.winnersPhaseKeysProvider || (() => []),
      onWinners: opts.onWinners || (() => {}),
      onPhaseChange: opts.onPhaseChange || (() => {}),
    });
    singletonPoller.start();
  } else {
    if (DEBUG) console.log("[CORE] initCore() called again — poller already active");
  }
}

/** Stop all core activity (mainly useful in teardown/tests). */
export function shutdownCore() {
  if (singletonPoller) {
    singletonPoller.stop();
    singletonPoller = null;
  }
}

/** Pause background activity (UI can call this when dialogs/etc open). */
export function setPaused(v) {
  paused = !!v;
  if (DEBUG) console.log("[CORE] paused=", paused);
}

/** State setters so other modules don’t reach into internals */
export function setPeriodSec(v) {
  if (Number.isFinite(v)) periodSec = v;
}
export function setServerPhaseEndISO(v) {
  serverPhaseEndISO = v;
}
export function setCurrentPhaseKey(v) {
  currentPhaseKey = v;
}
export function setPrevPhaseKey(v) {
  prevPhaseKey = v;
}
export function setRemainingSec(v) {
  if (Number.isFinite(v)) remainingSec = v;
}
export function setLastSyncAt(ts) {
  lastSyncAt = ts;
}
export function setLastCountsAt(ts) {
  lastCountsAt = ts;
}
export function setCurrentUid(uid) {
  currentUid = uid;
  paintLoginBadge();
}
export function setChosen(v) {
  chosen = v;
}

//////////////////////////////
// UI helpers
//////////////////////////////

function paintLoginBadge() {
  const el = loginBadgeEl();
  if (!el) return;
  el.textContent = currentUid ? `Signed in: ${currentUid}` : "Not signed in";
}

//////////////////////////////
// Optional helpers your other code can reuse
//////////////////////////////

/** Tally votes by color (or whatever structure your rows have). */
export function tallyVotes(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const k = r?.vote ?? r?.color ?? "unknown";
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

/** Row id helper if you’re mapping bracket rows to DOM */
export const rowId = (slot) => `row-${slot}`;