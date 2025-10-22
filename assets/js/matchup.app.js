<script type="module">
// ======= CONFIG =======
const EDGE_URL = 'https://tuqvpcevrhciursxrgav.supabase.co/functions/v1/global-timer-v2';
const SUPABASE_REST = 'https://tuqvpcevrhciursxrgav.supabase.co/rest/v1';
const SUPABASE_ANON_KEY = window?.ENV_SUPABASE_ANON_KEY || (window.localStorage.getItem('sb-anon') || '');
const AUTH_HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
};

// ======= ROUND / CLOCK SETTINGS (updated) =======
// One full game cycle is 100 → 0, with decisions every 20s at 100/80/60/40/20/0
const periodSec = 20;                                  // was 30
const CHECKPOINTS = [100, 80, 60, 40, 20, 0];          // explicit gates
let lastCheckpointFired = null;                        // what we’ve already pinged for this cycle

// ======= STATE =======
const G = {
  baseIso: null,
  clock: 100,             // show 100 at start
  lastCheckpoint: null,   // from server (read-only)
  bracket: null,
  paused: false,
  _prevClock: null,
};

// ======= UTIL =======
const log = (...args) => console.log(...args);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Compute a 0–100 clock from server payload.
// We clamp to the nearest integer to stabilize boundary checks.
function computeClockFromServer(payload) {
  // server might already return a 0..100 scale via payload.clock; if so, use it.
  if (typeof payload?.clock === 'number') {
    return Math.max(0, Math.min(100, Math.round(payload.clock)));
  }
  // fallback: derive from seconds-left
  if (typeof payload?.seconds_left === 'number') {
    const pct = (payload.seconds_left / 100) * 100; // keep 0..100 scale if server uses 100s horizon
    return Math.max(0, Math.min(100, Math.round(pct)));
  }
  // ultimate fallback: keep current
  return G.clock;
}

// POST helper to edge with JSON
async function postEdge(body) {
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`edge POST ${res.status}: ${t}`);
  }
  return res.json().catch(() => ({}));
}

// GET helper to edge
async function getEdge() {
  const res = await fetch(EDGE_URL, { method: 'GET' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`edge GET ${res.status}: ${t}`);
  }
  return res.json().catch(() => ({}));
}

// load advancers for the active baseIso
async function loadAdvancers(baseIso) {
  const url = `${SUPABASE_REST}/advancers_v2?select=phase_key,color,from_key&base_iso=eq.${encodeURIComponent(baseIso)}`;
  const res = await fetch(url, { headers: AUTH_HEADERS });
  if (!res.ok) throw new Error('advancers load failed');
  return res.json();
}

// load winners for a set of keys
async function loadWinners(keys) {
  if (!keys?.length) return [];
  const list = keys.map(encodeURIComponent).join(',');
  const url = `${SUPABASE_REST}/winners_v2?select=phase_key,color&phase_key=in.(${list})`;
  const res = await fetch(url, { headers: AUTH_HEADERS });
  if (!res.ok) throw new Error('winners load failed');
  return res.json();
}

// ======= RENDER (kept as-is, only where needed) =======
function renderClock() {
  const el = document.querySelector('[data-clock]');
  if (!el) return;
  el.textContent = String(G.clock);
}

// call after any bracket update
function renderBracket(bracketRows) {
  // your existing UI render function(s) — unchanged
  // (left intact because your DOM/layout is already working)
}

// ======= CHECKPOINT DRIVER (new) =======
function crossedCheckpoint(prev, curr) {
  if (prev == null) return null;
  // detect any checkpoint crossed between prev -> curr (counting down)
  for (const cp of CHECKPOINTS) {
    // prev >= cp > curr  OR exact hit
    if ((prev > cp && curr <= cp) || curr === cp) return cp;
  }
  return null;
}

async function handleCheckpoint(cp) {
  if (cp === lastCheckpointFired) return; // avoid double pings
  lastCheckpointFired = cp;
  log('[CLOCK]', 'checkpoint →', cp);

  // 1) Nudge the edge function to “decide” at this checkpoint
  //    (keeps authoritative logic server-side).
  //    If your edge expects a different op name like "decide" or "tick",
  //    change "checkpoint" accordingly; the idea is the same.
  try {
    await postEdge({ op: 'checkpoint', at: cp });
  } catch (e) {
    console.warn('edge checkpoint post failed', e);
  }

  // 2) Shortly after, refresh bracket data (so UI advances as soon as the backend writes)
  await sleep(1000);
  try {
    const adv = await loadAdvancers(G.baseIso);
    G.bracket = adv;
    renderBracket(adv);
  } catch (e) {
    console.warn('advancers refresh failed after checkpoint', e);
  }
}

// ======= POLL / TICK LOOP =======
let edgePollInterval = null;
let clockPaintInterval = null;

function startLoops() {
  // Poll edge every ~25s for fresh clock/base/checkpoint (kept from your logs cadence)
  if (edgePollInterval) clearInterval(edgePollInterval);
  edgePollInterval = setInterval(async () => {
    try {
      const data = await getEdge();
      if (data?.base_iso) G.baseIso = data.base_iso;

      const newClock = computeClockFromServer(data);
      const prev = G._prevClock ?? newClock;
      G.clock = newClock;
      G._prevClock = newClock;

      // fire checkpoint if we crossed one (100/80/60/40/20/0)
      const cp = crossedCheckpoint(prev, newClock);
      if (cp !== null) {
        handleCheckpoint(cp);
      }

      // Update local lastCheckpoint if server provides it (read-only origin)
      if (typeof data?.last_checkpoint === 'number') {
        G.lastCheckpoint = data.last_checkpoint;
      }

      renderClock();
    } catch (e) {
      console.warn('edge poll failed', e);
    }
  }, 25000);

  // Smooth-ish paint for the clock text to feel live (every 1s)
  if (clockPaintInterval) clearInterval(clockPaintInterval);
  clockPaintInterval = setInterval(() => {
    renderClock();
  }, 1000);
}

async function initialBoot() {
  log('[DEBUG]', 'boot');
  // tell the edge “we’re here”; also makes sure a base is created if needed
  try {
    await postEdge({ op: 'ensure-base', periodSec, checkpoints: CHECKPOINTS });
  } catch (e) {
    console.warn('ensure-base failed', e);
  }

  // prime all data right away
  try {
    const data = await getEdge();
    if (data?.base_iso) G.baseIso = data.base_iso;
    G.clock = computeClockFromServer(data);
    G._prevClock = G.clock;
    if (typeof data?.last_checkpoint === 'number') {
      G.lastCheckpoint = data.last_checkpoint;
    }
    renderClock();
  } catch (e) {
    console.warn('initial edge get failed', e);
  }

  // load bracket on boot
  if (G.baseIso) {
    try {
      const adv = await loadAdvancers(G.baseIso);
      G.bracket = adv;
      renderBracket(adv);
    } catch (e) {
      console.warn('initial advancers load failed', e);
    }
  }

  // spin the loops
  startLoops();
}

// ======= ACTION BUTTONS (unchanged API) =======
async function onPause() {
  try {
    await postEdge({ op: 'pause' });
  } catch (e) { /* noop */ }
}
async function onResume() {
  try {
    await postEdge({ op: 'resume' });
  } catch (e) { /* noop */ }
}
async function onReset() {
  try {
    // reset back to 100 with our 20s checkpoints
    await postEdge({ op: 'reset', periodSec, checkpoints: CHECKPOINTS });
    lastCheckpointFired = null;
  } catch (e) { /* noop */ }
}

// ======= BOOT =======
initialBoot();

</script>