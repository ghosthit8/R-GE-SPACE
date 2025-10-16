// js/core.js — core state, helpers, fixed R32 seeding, and edge helpers

export const SUPABASE_URL = "https://tuqvpcevrhciursxrgav.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y";
export const EDGE_URL = `${SUPABASE_URL}/functions/v1/global-timer`;

// Supabase client (UMD from matchup.html)
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- DOM Refs ---------- */
export const clockEl = document.getElementById("clock");
export const stateEl = document.getElementById("state");
export const phaseBadge = document.getElementById("phaseKey");
export const loginBadge = document.getElementById("loginBadge");
export const pauseBtn = document.getElementById("btnPause");
export const toastEl = document.getElementById("toast");

export const imgA = document.getElementById("imgA");
export const imgB = document.getElementById("imgB");
export const labelA = document.getElementById("labelA");
export const labelB = document.getElementById("labelB");
export const countA = document.getElementById("countA");
export const countB = document.getElementById("countB");
export const voteA = document.getElementById("voteA");
export const voteB = document.getElementById("voteB");
export const submitBtn = document.getElementById("submitBtn");

export const fsOverlay = document.getElementById("fsOverlay");
export const fsImage   = document.getElementById("fsImage");
export const fsClose   = document.getElementById("fsClose");

export const overlay = document.getElementById("overlay");
export const overlayArtImg = document.getElementById("overlayArtImg");
export const overlayTitle = document.getElementById("overlayTitle");
export const overlaySubtitle = document.getElementById("overlaySubtitle");
export const overlayMotto = document.getElementById("overlayMotto");
export const overlayClose = document.getElementById("overlayClose");
export const confettiCanvas = document.getElementById("confetti");

export const brows = document.getElementById("brows");
export const showDone = document.getElementById("showDone");

/* ---------- Global State (mutable here) ---------- */
export let paused = false;
export let serverPhaseEndISO = null;
export let currentPhaseKey = null;
export let prevPhaseKey = null;
export let periodSec = 20;
export let remainingSec = null;
export let lastSyncAt = 0;
export let lastCountsAt = 0;

export let currentUid = null;
export let chosen = null;

export let activeSlot = "r32_1";
export let currentStage = "r32";
export let overlayGateBase = null;

export const imgCache = new Map();
export let lastPaintedBattleKey = null;

/* ---------- Boot Loader UI ---------- */
const _bootFill = () => document.getElementById("bootFill");
const _bootMsg  = () => document.getElementById("bootMsg");
const _bootWrap = () => document.getElementById("bootLoader");
let _bootTarget = 0, _bootTimer = null;

export function setBoot(p, msg) {
  _bootTarget = Math.max(_bootTarget, Math.min(100, p));
  if (msg) _bootMsg().textContent = msg;
}
export function startBootTick() {
  if (_bootTimer) return;
  _bootTimer = setInterval(() => {
    const el = _bootFill();
    const cur = parseFloat(el.style.width || "0");
    const toward = _bootTarget > cur ? cur + Math.max(1, (_bootTarget - cur) * 0.12) : cur + 0.18;
    el.style.width = Math.min(99, toward).toFixed(2) + "%";
  }, 60);
}
export function endBoot() {
  clearInterval(_bootTimer);
  _bootTimer = null;
  _bootFill().style.width = "100%";
  setTimeout(() => _bootWrap().classList.add("hidden"), 280);
}

/* ---------- Utils ---------- */
export const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");

// ✅ Restored — required by services.js
export function seedUrlFromKey(baseISO, suffix) {
  const s = encodeURIComponent(`${baseISO}-${suffix}`);
  return `https://picsum.photos/seed/${s}/1600/1200`;
}

export function toast(msg, ms = 1400) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), ms);
}

export async function getUidOrNull() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export function paintLoginBadge() {
  if (currentUid) {
    loginBadge.textContent = "logged in";
    loginBadge.classList.add("ok");
    loginBadge.classList.remove("warn");
  } else {
    loginBadge.textContent = "not logged in";
    loginBadge.classList.add("warn");
    loginBadge.classList.remove("ok");
  }
}

/* ---------- Edge calls ---------- */
export async function callEdge(method = "GET", body = null, { timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let res, raw, j;
  try {
    res = await fetch(EDGE_URL, {
      method,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: body ? JSON.stringify(body) : null,
    });
    raw = await res.text();
    try { j = JSON.parse(raw); } catch {}
  } catch (e) {
    clearTimeout(t);
    console.error("[edge] network error:", e);
    throw new Error(e.name === "AbortError" ? "Edge request timed out" : "Edge fetch failed");
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const msg = (j && (j.error || j.message)) || raw || `HTTP ${res.status}`;
    console.error("[edge] bad response:", msg);
    throw new Error(msg);
  }
  return j?.state || j || {};
}

/* Try POST first, then GET ?action=… as a fallback */
export async function toggleTimer(action /* "pause"|"resume" */) {
  try { return await callEdge("POST", { action }); }
  catch (e) {
    const u = new URL(EDGE_URL);
    u.searchParams.set("action", action);
    const res = await fetch(u.toString(), { method: "GET" });
    const raw = await res.text();
    let j; try { j = JSON.parse(raw); } catch {}
    if (!res.ok) throw new Error((j && (j.error || j.message)) || raw || `HTTP ${res.status}`);
    return j?.state || j || {};
  }
}

export const normalize = (s) => ({
  phase_end_at: s.phase_end_at ?? null,
  period_sec: s.period_sec ?? 20,
  paused: !!s.paused,
  remaining_sec: typeof s.remaining_sec === "number" ? s.remaining_sec : null,
});

/* ---------- Fixed 32-image pool for R32 ---------- */
export const SEED32 = [
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41,
];
export function picsum1600x1200(id) { return `https://picsum.photos/id/${id}/1600/1200`; }
export function fixedSeedPair(slot) {
  const n = Number(String(slot).split("_")[1]);
  if (!n || n < 1 || n > 16) return { A: "", B: "" };
  const aIdx = n - 1;
  const bIdx = 16 + (n - 1);
  return { A: picsum1600x1200(SEED32[aIdx]), B: picsum1600x1200(SEED32[bIdx]) };
}

/* ---------- Stage math ---------- */
export const stageOfSlot = (slot) =>
  slot.startsWith("r32") ? "r32" :
  slot.startsWith("r16") ? "r16" :
  slot.startsWith("qf")  ? "qf"  :
  slot.startsWith("sf")  ? "sf"  : "final";

export const stageLevel = (st) => st==="r32"?1 : st==="r16"?2 : st==="qf"?3 : st==="sf"?4 : 5;
export const slotLevel  = (slot)=> stageLevel(stageOfSlot(slot));

export function baseAtOffset(n) {
  if (!currentPhaseKey) return null;
  const t = Date.parse(currentPhaseKey) - Math.max(0, n) * periodSec * 1000;
  return iso(t);
}
export function baseForSlot(slot) {
  const curLv = stageLevel(currentStage || "r32");
  const needLv = slotLevel(slot);
  const delta = curLv - needLv;
  if (delta <= 0) return currentPhaseKey;
  return baseAtOffset(delta);
}
export function baseForCompletedStage(stage) {
  const curLv = stageLevel(currentStage || "r32");
  const needLv = stageLevel(stage);
  const delta = curLv - needLv;
  if (delta <= 0) return null;
  return baseAtOffset(delta);
}

/* ---------- UI Helpers ---------- */
export function setStateUI() {
  stateEl.textContent = paused ? "PAUSED" : "LIVE";
  pauseBtn.textContent = paused ? "▶️ Resume" : "⏸️ Pause";
  phaseBadge.textContent = "phase: " + (currentPhaseKey || "—");
}
export function slotFinished(slot){ return slotLevel(slot) < stageLevel(currentStage || "r32"); }
export function votingLockedFor(slot){ return slotLevel(slot) !== stageLevel(currentStage || "r32"); }
export function applyVotingLockUI(){
  const locked = votingLockedFor(activeSlot);
  [voteA, voteB, submitBtn].forEach((b) => (b.disabled = locked || !currentUid));
  const finished = slotFinished(activeSlot);
  document.getElementById("tileA").classList.toggle("decided", finished);
  document.getElementById("tileB").classList.toggle("decided", finished);
  submitBtn.textContent = locked ? (finished ? "Voting closed" : "Not started") : "✅ Submit Vote";
}

/* ---------- setters ---------- */
export function setPaused(v){ paused=v; setStateUI(); }
export function setPeriodSec(v){ periodSec=v; }
export function setServerPhaseEndISO(v){ serverPhaseEndISO=v; }
export function setCurrentPhaseKey(v){ currentPhaseKey=v; }
export function setPrevPhaseKey(v){ prevPhaseKey=v; }
export function setRemainingSec(v){ remainingSec=v; }
export function setLastSyncAt(ts){ lastSyncAt=ts; }
export function setLastCountsAt(ts){ lastCountsAt=ts; }
export function setCurrentUid(uid){ currentUid=uid; paintLoginBadge(); }
export function setChosen(v){ chosen=v; }

export function setActiveSlot(v){ activeSlot=v; }
export function setCurrentStage(v){ currentStage=v; }
export function setOverlayGateBase(v){ overlayGateBase=v; }
export function setLastPaintedBattleKey(v){ lastPaintedBattleKey=v; }

/* ---------- Convenience ---------- */
export const rowId = (slot) => `row-${slot}`;