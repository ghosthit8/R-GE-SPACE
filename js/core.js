// js/core.js
// Core primitives, network polling, and utilities.
// Consolidates all polling into a single guarded loop with backoff,
// restores a resilient Debug button, and prevents duplicate work.

//////////////////////////////
// Config & Clients
//////////////////////////////

export const SUPABASE_URL = "https://tuqvpcevrhciursxrgav.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTg3MTUyOTgsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y";
export const EDGE_URL = `${SUPABASE_URL}/functions/v1/global-timer`;

// Supabase client (UMD from HTML)
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

//////////////////////////////
// DOM Refs (lazily resolved)
//////////////////////////////

const $ = (id) => document.getElementById(id);
const refs = new Proxy({}, { get: (_, k) => $(`${k}`) || null });
const clockEl = () => refs["clock"];
const loginBadgeEl = () => refs["loginBadge"];

//////////////////////////////
// Global State
//////////////////////////////

let paused = false;

let periodSec = 5;
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

const jitter = (baseMs, spreadRatio = 0.25) => {
  const spread = baseMs * spreadRatio;
  return baseMs + (Math.random() * 2 - 1) * spread;
};

function once(fn) {
  let done = false;
  return (...args) => {
    if (done) return;
    done = true;
    return fn(...args);
  };
}

function startClock() {
  let rafId = 0;
  const tick = () => {
    if (paused) return;
    const el = clockEl();
    if (el && remainingSec != null) el.textContent = String(remainingSec);
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
    btn.style.border = "1px solid #0f0";
    btn.style.background = "black";
    btn.style.color = "#4cff4c";
    btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";
    btn.style.fontFamily = "system-ui, sans-serif";
    btn.style.fontSize = "12px";
    btn.title = "Toggle debug overlay";
    btn.textContent = "Debug: OFF";
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

    this._votesBackoff = 0;
    this._edgeBackoff = 0;

    this._onCounts = onCounts;
    this._onWinners = onWinners;
    this._winnersKeys = winnersPhaseKeysProvider;
    this._onPhaseChange = onPhaseChange;

    this._votesInflight = false;
    this._winnersInflight = false;
    this._edgeInflight = false;

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
      this._tick(true);
    }
  }

  async _loop() {
    const cancelClock = startClock();
    this._stop = once(() => cancelClock());

    while (this._running) {
      await this._tick(false);
      const base = document.hidden ? Math.max(this.cfg.votesEveryMs, 10000) : this.cfg.votesEveryMs;
      await sleep(jitter(base));
    }
  }

  async _tick(force) {
    if (paused) return;

    if (!this._votesInflight) {
      this._votesInflight = true;
      this._pollVotes()
        .catch((e) => {
          if (DEBUG) console.warn("[POLL] votes error", e);
          this._votesBackoff = Math.min(30000, this._votesBackoff ? this._votesBackoff * 2 : 2000);
        })
        .finally(() => (this._votesInflight = false));
    }

    if (!this._winnersInflight) {
      const keys = this._winnersKeys();
      if (keys && keys.length) {
        this._winnersInflight = true;
        this._pollWinners(keys)
          .catch((e) => {
            if (DEBUG) console.warn("[POLL] winners error", e);
          })
          .finally(() => (this._winnersInflight = false));
      }
    }

    if (!this._edgeInflight && (force || !document.hidden)) {
      this._edgeInflight = true;
      this._pollEdge()
        .catch((e) => {
          if (DEBUG) console.warn("[POLL] edge error", e);
          this._edgeBackoff = Math.min(30000, this._edgeBackoff ? this._edgeBackoff * 2 : 2000);
        })
        .finally(() => (this._edgeInflight = false));
    }
  }

  async _pollVotes() {
    const wait = this._votesBackoff || 0;
    if (wait) await sleep(wait);

    const url = `${SUPABASE_URL}/rest/v1/phase_votes?select=vote`;
    const res = await fetchWithTimeout(url, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error(`votes ${res.status}`);
    const data = await res.json();

    lastCountsAt = now();
    this._votesBackoff = 0;

    this._onCounts(data);
    if (DEBUG)
      console.log(`[NET] votes (${data.length}) @ ${new Date(lastCountsAt).toLocaleTimeString()}`);
  }

  async _pollWinners(phaseKeys) {
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
      if (r.status === "fulfilled") map.set(key, r.value);
      else if (DEBUG) console.warn("[NET] winners fail for", key, r.reason);
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

    const { phase, serverNow, period } = normalizeEdgePayload(payload);

    if (period && Number.isFinite(period)) {
      periodSec = Math.max(2, Math.min(30, period));
    }

    if (phase && phase !== currentPhaseKey) {
      prevPhaseKey = currentPhaseKey;
      currentPhaseKey = phase;
      this._onPhaseChange({ prev: prevPhaseKey, next: currentPhaseKey });
      if (DEBUG) console.log("[STAGE] phaseKey →", currentPhaseKey);
    }

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

export function initCore(opts = {}) {
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
  } else if (DEBUG) {
    console.log("[CORE] initCore() called again — poller already active");
  }
}

export function shutdownCore() {
  if (singletonPoller) {
    singletonPoller.stop();
    singletonPoller = null;
  }
}

export function setPaused(v) {
  paused = !!v;
  if (DEBUG) console.log("[CORE] paused=", paused);
}

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

export function tallyVotes(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const k = r?.vote ?? r?.color ?? "unknown";
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

export const rowId = (slot) => `row-${slot}`;

//////////////////////////////
// ===== compat + UI shims ===
// (append-only; safe to remove later by updating callers)
//////////////////////////////

// public bucket default
export const DEFAULT_PUBLIC_BUCKET = "art-uploads";

/** map stageKey → base ISO (fallback to top-of-hour) */
export function baseForCompletedStage(stageKey, state) {
  try {
    if (state?.bases?.[stageKey]) return state.bases[stageKey];
    if (state?.base_iso) return state.base_iso;
    const d = new Date(); d.setMinutes(0,0,0); return d.toISOString();
  } catch { return new Date().toISOString(); }
}

/** close overlay + exit native fullscreen if any */
export function fsClose() {
  try {
    const overlay = document.querySelector('[data-fullscreen-overlay]');
    if (overlay) { overlay.classList.add('hidden'); overlay.removeAttribute('data-open'); }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  } catch {}
  return true;
}

/** map slot/phase (e.g., r32_1) → base ISO */
export function baseForSlot(slotOrPhase, state) {
  try {
    const stage = String(slotOrPhase || '').split('_')[0];
    if (state?.bases?.[stage]) return state.bases[stage];
    if (state?.base_iso) return state.base_iso;
    const d = new Date(); d.setMinutes(0,0,0); return d.toISOString();
  } catch { return new Date().toISOString(); }
}

/** overlay an image URL or <img> */
export function fsImage(target) {
  try {
    if (target instanceof Element && target.requestFullscreen) return target.requestFullscreen();
    const url = typeof target === 'string' ? target :
      (target && typeof target === 'object' && 'src' in target ? target.src : null);
    if (!url) return false;

    let overlay = document.querySelector('[data-fullscreen-overlay]');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-fullscreen-overlay','');
      overlay.style.position='fixed'; overlay.style.inset='0';
      overlay.style.background='rgba(0,0,0,0.92)';
      overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
      overlay.style.zIndex='999999'; overlay.classList.add('hidden');
      overlay.addEventListener('click', (e)=>{ if (e.target===overlay) fsClose(); });
      document.body.appendChild(overlay);
    }
    let img = overlay.querySelector('img');
    if (!img) { img = document.createElement('img'); img.style.maxWidth='95vw'; img.style.maxHeight='95vh'; img.style.objectFit='contain'; overlay.appendChild(img); }
    img.src = url;
    overlay.classList.remove('hidden'); overlay.setAttribute('data-open','1');
    if (!document.fullscreenElement && overlay.requestFullscreen) overlay.requestFullscreen().catch(()=>{});
    return true;
  } catch { return false; }
}

/** deterministic pairing numbers for bracket slots */
export function fixedSeedPair(slotOrPhase) {
  const stage = String(slotOrPhase || '').split('_')[0];
  const m = String(slotOrPhase || '').match(/(\d+)/);
  const i = m ? Math.max(1, parseInt(m[1], 10)) : 1;
  const a = (i - 1) * 2 + 1, b = a + 1;
  switch (stage) { case 'r32': case 'r16': case 'qf': case 'sf': return [a,b]; default: return [1,2]; }
}

/** general purpose overlay container for arbitrary content */
export function fsOverlay(content) {
  try {
    let overlay = document.querySelector('[data-fullscreen-overlay]');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-fullscreen-overlay','');
      overlay.style.position='fixed'; overlay.style.inset='0';
      overlay.style.background='rgba(0,0,0,0.92)';
      overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
      overlay.style.zIndex='999999'; overlay.classList.add('hidden');
      overlay.addEventListener('click',(e)=>{ if (e.target===overlay) fsClose(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    const frame = document.createElement('div');
    frame.style.maxWidth='95vw'; frame.style.maxHeight='95vh'; frame.style.overflow='auto';
    overlay.appendChild(frame);
    if (content instanceof Element) frame.appendChild(content);
    else if (typeof content === 'string') frame.innerHTML = content;
    overlay.classList.remove('hidden'); overlay.setAttribute('data-open','1');
    if (!document.fullscreenElement && overlay.requestFullscreen) overlay.requestFullscreen().catch(()=>{});
    return true;
  } catch { return false; }
}

/** build storage URL for a base + key (e.g., 'A1') */
export function seedUrlFromKey(baseIsoOrLabel, key, opts = {}) {
  if (!key) return '';
  if (/^https?:\/\//i.test(key)) return key;
  const bucket = opts.bucket || DEFAULT_PUBLIC_BUCKET;
  const ext = (opts.ext || '.jpg').replace(/^\./,'.');
  let base = String(baseIsoOrLabel || '').trim();
  if (base.includes('T')) base = base.split('T')[0];
  if (!base) base = 'seed';
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(base)}/${encodeURIComponent(key)}${ext}`;
}

/** convenience accessors for main image elements */
export function imgA(selector) {
  if (selector && typeof selector === 'string') { const el = document.querySelector(selector); if (el) return el; }
  return document.querySelector('#imgA') || document.querySelector('#A') ||
         document.querySelector('img[data-role="A"]') || document.querySelector('.imgA') || null;
}
export function imgB(selector) {
  if (selector && typeof selector === 'string') { const el = document.querySelector(selector); if (el) return el; }
  return document.querySelector('#imgB') || document.querySelector('#B') ||
         document.querySelector('img[data-role="B"]') || document.querySelector('.imgB') || null;
}

/** small DOM helper bundle some features import */
export const brows = {
  qs: (sel, root=document) => root.querySelector(sel),
  qsa: (sel, root=document) => Array.from(root.querySelectorAll(sel)),
  on: (el, evt, fn, opts) => { if (el) el.addEventListener(evt, fn, opts); return el; },
  css: (el, styles={}) => { if (el && styles) Object.assign(el.style, styles); return el; },
};

/** fullscreen canvas for confetti and FX */
export function confettiCanvas() {
  let c = document.getElementById('confetti-canvas');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'confetti-canvas';
    c.style.position='fixed'; c.style.inset='0';
    c.style.pointerEvents='none'; c.style.zIndex='999990';
    document.body.appendChild(c);
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.floor(window.innerWidth * dpr);
      c.height = Math.floor(window.innerHeight * dpr);
      c.style.width = '100vw'; c.style.height = '100vh';
      const ctx = c.getContext('2d'); if (ctx) ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    fit();
    window.addEventListener('resize', fit, { passive: true });
  }
  return c;
}