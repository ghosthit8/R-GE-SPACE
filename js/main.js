/* main.js — resilient boot with Supabase meta/global auto-inject + Edge support
   - Removes legacy 3s offline path
   - Resilient timer fetch with 5.5s timeout + backoff retries
   - Control buttons: Force decide / Reset 30s / Pause-Resume
*/
(() => {
  'use strict';

  const stamp = () => `[${new Date().toLocaleTimeString()}]`;
  const log  = (...a) => console.log(stamp(), ...a);
  const warn = (...a) => console.warn(stamp(), 'WARN:', ...a);
  const $ = (q) => document.querySelector(q);

  // ---------------------------------------------------------------
  // 🧩 Meta helpers and auto-injection if tags are missing
  // ---------------------------------------------------------------
  const hasMeta = (name) => !!document.querySelector(`meta[name="${name}"]`);
  const ensureMeta = (name, value) => {
    if (!hasMeta(name)) {
      const m = document.createElement('meta');
      m.name = name;
      m.content = value;
      document.head.appendChild(m);
      log(`Injected <meta name="${name}">`);
      return true; // we injected
    }
    return false; // already present
  };

  const FALLBACK_URL  = 'https://tuqvpcevrhciursxrgav.supabase.co';
  const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y';

  const hadMetaUrl  = hasMeta('supabase-url');
  const hadMetaAnon = hasMeta('supabase-anon-key');

  // Keep meta fallbacks (harmless if globals are set in HTML)
  const injectedUrl  = ensureMeta('supabase-url', FALLBACK_URL);
  const injectedAnon = ensureMeta('supabase-anon-key', FALLBACK_ANON);

  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content?.trim();

  // ---------------------------------------------------------------
  // 🔑 Resolve config (window globals > meta > fallback)
  // ---------------------------------------------------------------
  const SUPA_URL =
    (window.SUPABASE_URL && String(window.SUPABASE_URL)) ||
    meta('supabase-url') || FALLBACK_URL;

  const SUPA_ANON =
    (window.SUPABASE_ANON_KEY && String(window.SUPABASE_ANON_KEY)) ||
    meta('supabase-anon-key') || FALLBACK_ANON;

  // ---------------------------------------------------------------
  // 📡 Endpoints + headers
  // ---------------------------------------------------------------
  const WINNERS = (keys) =>
    `${SUPA_URL}/rest/v1/winners?select=phase_key&phase_key=in.%28${keys.map(encodeURIComponent).join('%2C')}%29`;
  const VOTES      = `${SUPA_URL}/rest/v1/phase_votes?select=vote`;
  const EDGE_TIMER = `${SUPA_URL}/functions/v1/global-timer`;

  const SB_HEADERS = {
    apikey: SUPA_ANON,
    Authorization: `Bearer ${SUPA_ANON}`,
  };

  // ---------------------------------------------------------------
  // 💻 UI helpers
  // ---------------------------------------------------------------
  const ui = {
    statusEl: $('#boot-status') || $('#bootMsg') || { textContent: '' },
    toastBox: $('#toast') || null,
    setStatus(txt) {
      this.statusEl.textContent = txt;
      log('STATUS:', txt);
    },
    toast(msg) {
      log('TOAST:', msg);
      if (!this.toastBox) return;
      this.toastBox.textContent = msg;
      this.toastBox.classList.add('show');
      setTimeout(() => this.toastBox.classList.remove('show'), 2500);
    },
  };

  // ---------------------------------------------------------------
  // 🕹 State + small utils
  // ---------------------------------------------------------------
  const state = {
    timer: { ok: false, lastEdgeIso: null, offline: false },
    winners: new Set(),
    votesTotal: 0,
    booted: false,
  };

  function withAbortTimeout(ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort('timeout'), ms);
    return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
  }

  async function getJSON(url, opts = {}) {
    const r = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { ...SB_HEADERS, ...(opts.headers || {}) },
      signal: opts.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`${r.status} ${r.statusText}  - ${text}`);
    }
    return r.json();
  }

  // ---------------------------------------------------------------
  // ⏱ Resilient timer sync: 5.5s timeout + backoffs
  // ---------------------------------------------------------------
  const EDGE_TIMEOUT_MS = 5500;
  const EDGE_BACKOFF_MS = [0, 1200, 2400];

  async function syncTimerOnce() {
    if (window.__EDGE_TIMER_IN_FLIGHT__) return null;
    window.__EDGE_TIMER_IN_FLIGHT__ = true;
    window.__EDGE_TIMER_FAILED__ = false;

    for (let i = 0; i < EDGE_BACKOFF_MS.length; i++) {
      if (i > 0) {
        log('TIMER:', `backoff ${i+1} @ ${EDGE_BACKOFF_MS[i]}ms`);
        await new Promise(r => setTimeout(r, EDGE_BACKOFF_MS[i]));
      }
      const at = withAbortTimeout(EDGE_TIMEOUT_MS);
      const t0 = performance.now();
      try {
        const json = await getJSON(EDGE_TIMER, { signal: at.signal });
        const ms = (performance.now() - t0).toFixed(0);
        log('EDGE:', 'GET', EDGE_TIMER, `→ 200 (${ms}ms)`);
        state.timer.ok = true;
        state.timer.offline = false;
        state.timer.lastEdgeIso = json?.state?.phase_end_at || json?.now || null;
        window.__EDGE_TIMER_IN_FLIGHT__ = false;
        window.__EDGE_TIMER_FAILED__ = false;
        maybeClearOfflineToast();
        return json;
      } catch (err) {
        at.cancel();
        const last = i === EDGE_BACKOFF_MS.length - 1;
        warn(`timer attempt #${i+1} failed`, err?.message || err);
        if (last) {
          window.__EDGE_TIMER_IN_FLIGHT__ = false;
          window.__EDGE_TIMER_FAILED__ = true;
          state.timer.ok = false;
          state.timer.offline = true;
          showOfflineToastOnce();
          return null;
        }
      }
    }
  }

  // Offline toast guard
  let offlineToastShown = false;
  function showOfflineToastOnce() {
    if (offlineToastShown) return;
    offlineToastShown = true;
    ui.toast("Couldn't reach timer. Offline mode.");
  }
  function maybeClearOfflineToast() {
    if (!offlineToastShown) return;
    offlineToastShown = false;
    ui.toast('Timer reachable again. Online.');
  }

  // ---------------------------------------------------------------
  // Data fetchers (winners/votes) — unchanged, but no legacy 3s timer
  // ---------------------------------------------------------------
  async function fetchState() {
    const sf  = ['sf1', 'sf2'];
    const qf  = ['qf1', 'qf2', 'qf3', 'qf4'];
    const r16 = Array.from({ length: 8 },  (_, i) => `r16_${i + 1}`);
    const r32 = Array.from({ length: 16 }, (_, i) => `r32_${i + 1}`);

    const winnersP = Promise.all([
      getJSON(WINNERS(sf)),
      getJSON(WINNERS(qf)),
      getJSON(WINNERS(r16)),
      getJSON(WINNERS(r32)),
    ]);
    const votesP = getJSON(VOTES);
    const [w1, w2, w3, w4] = await winnersP;
    const votes = await votesP;

    state.winners = new Set(
      [...w1, ...w2, ...w3, ...w4].map((r) => r.phase_key).filter(Boolean)
    );
    state.votesTotal = Array.isArray(votes) ? votes.length : 0;
  }

  // ---------------------------------------------------------------
  // 🚀 Boot sequence (no legacy 3s offline toast)
  // ---------------------------------------------------------------
  async function boot() {
    ui.setStatus('initializing');

    // Visual watchdog: move the boot bar a bit while we work
    const fill = $('#bootFill');
    const setFill = (p) => { if (fill) fill.style.width = `${Math.min(100, Math.max(0, p))}%`; };
    setFill(10);

    try {
      ui.setStatus('syncing…');
      setFill(30);
      await fetchState();
      setFill(55);
      await syncTimerOnce();
      setFill(86);
      proceed();
    } catch (e) {
      console.error('ERR:', e);
      ui.toast("You're offline or unauthorized. Showing cached/empty view.");
      proceed(true);
    }
  }

  function proceed(offlined = false) {
    if (state.booted) return;
    state.booted = true;
    ui.setStatus('ready');
    setFillSafe(100);
    startLoop();
    if (offlined) showOfflineToastOnce();
  }

  function setFillSafe(p){ const f=$('#bootFill'); if (f) f.style.width = `${p}%`; }

  // ---------------------------------------------------------------
  // ⏱ Render loop + debug hook
  // ---------------------------------------------------------------
  let raf = 0;
  function startLoop() {
    cancelAnimationFrame(raf);
    const tick = () => { raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }

  window.appDebug = {
    state,
    refresh: async () => {
      ui.toast('Refreshing…');
      await fetchState();
      await syncTimerOnce();
      ui.toast('Refreshed');
    },
  };

  // ---------------------------------------------------------------
  // 🧰 Control buttons wiring (Edge actions)
  // ---------------------------------------------------------------
  const EDGE = EDGE_TIMER;
  async function callEdge(action, extra='') {
    const url = `${EDGE}?action=${action}${extra}`;
    const r = await fetch(url, { method:'GET' });
    if (!r.ok) throw new Error(`${action} → ${r.status}`);
    const j = await r.json().catch(()=> ({}));
    // If you render the countdown, hook here with j.state
    return j;
  }

  $('#btnForceDecide')?.addEventListener('click', async () => {
    try {
      ui.toast('Forcing decision…');
      await callEdge('advance');
      await syncTimerOnce();
      ui.toast('Advanced');
    } catch (e) { warn('force decide failed', e?.message||e); }
  });

  $('#btnReset30')?.addEventListener('click', async () => {
    try {
      ui.toast('Resetting 30s…');
      await callEdge('reset', '&period=30');
      await syncTimerOnce();
      ui.toast('Reset');
    } catch (e) { warn('reset failed', e?.message||e); }
  });

  $('#btnPauseResume')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const stateAttr = btn.dataset.state || 'run';
    try {
      if (stateAttr === 'run') {
        await callEdge('pause');
        btn.dataset.state = 'pause';
        btn.textContent = '▶️ Resume';
        ui.toast('Paused');
      } else {
        await callEdge('resume');
        btn.dataset.state = 'run';
        btn.textContent = '⏸️ Pause';
        ui.toast('Resumed');
      }
      await syncTimerOnce();
    } catch (e) { warn('pause/resume failed', e?.message||e); }
  });

  // ---------------------------------------------------------------
  // 🟢 Start
  // ---------------------------------------------------------------
  log('Debugger ready');
  // Prevent double init if concatenated
  if (!window.__RAGE_TIMER_PATCHED__) {
    window.__RAGE_TIMER_PATCHED__ = true;
    boot();
    // Optional: keep warm polling every minute for freshness
    setInterval(syncTimerOnce, 60_000);
  }
})(); // EOF