/* main.js — resilient boot with Supabase auth headers + meta/global support */
(() => {
  const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
  const $ = (q) => document.querySelector(q);

  // Read <meta name="..."> helpers
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content?.trim();

  // --- config resolution ----------------------------------------------------
  const FALLBACK_URL  = 'https://tuqvpcevrhciursxrgav.supabase.co';
  const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y';

  const SUPA_URL =
    (window.SUPABASE_URL && String(window.SUPABASE_URL)) ||
    meta('supabase-url') || FALLBACK_URL;

  const SUPA_ANON =
    (window.SUPABASE_ANON_KEY && String(window.SUPABASE_ANON_KEY)) ||
    meta('supabase-anon-key') || FALLBACK_ANON;

  if (!window.SUPABASE_ANON_KEY && !meta('supabase-anon-key')) {
    console.warn('Supabase anon key not found via meta/global; using fallback constant.');
  }

  // Endpoints derived from resolved URL
  const WINNERS = (keys) =>
    `${SUPA_URL}/rest/v1/winners?select=phase_key&phase_key=in.%28${keys.map(encodeURIComponent).join('%2C')}%29`;
  const VOTES      = `${SUPA_URL}/rest/v1/phase_votes?select=vote`;
  const EDGE_TIMER = `${SUPA_URL}/functions/v1/global-timer`;

  // shared headers for Supabase REST + Edge Functions
  const SB_HEADERS = {
    apikey: SUPA_ANON,
    Authorization: `Bearer ${SUPA_ANON}`,
  };

  // --- UI helpers -----------------------------------------------------------
  const ui = {
    statusEl: $('#boot-status') || { textContent: '' },
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

  // --- small utils ----------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (p, ms, onTimeout) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        onTimeout?.();
        resolve({ __timeout: true });
      }, ms);
      p.then((v) => { clearTimeout(t); resolve(v); })
       .catch((e) => { clearTimeout(t); reject(e); });
    });

  async function getJSON(url, opts={}) {
    const r = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { ...SB_HEADERS, ...(opts.headers || {}) },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`${r.status} ${r.statusText}  - ${text}`);
    }
    return r.json();
  }

  // --- app state ------------------------------------------------------------
  const state = {
    timer: { ok: false, lastEdgeIso: null, offline: false },
    winners: new Set(),
    votesTotal: 0,
    booted: false,
  };

  // --- non-blocking timer probe --------------------------------------------
  async function probeEdgeTimer() {
    const res = await withTimeout(
      getJSON(EDGE_TIMER),
      1500,
      () => {
        state.timer.offline = true;
        ui.toast("Couldn't reach timer. Offline mode.");
      }
    );
    if (!res || res.__timeout) return;
    state.timer.ok = true;
    state.timer.lastEdgeIso = res?.now || null;
  }

  // --- fetch game state -----------------------------------------------------
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
    const timerP = probeEdgeTimer(); // doesn’t gate boot

    const [w1, w2, w3, w4] = await winnersP;
    const votes = await votesP;

    state.winners = new Set(
      [...w1, ...w2, ...w3, ...w4].map((r) => r.phase_key).filter(Boolean)
    );
    state.votesTotal = Array.isArray(votes) ? votes.length : 0;

    timerP.catch(() => { state.timer.offline = true; });
  }

  // --- boot sequence with watchdog -----------------------------------------
  async function boot() {
    ui.setStatus('initializing');

    let forced = false;
    const watchdog = setTimeout(() => {
      if (state.booted) return;
      forced = true;
      ui.toast('Network slow. Continuing without timer.');
      proceed();
    }, 2500);

    try {
      ui.setStatus('syncing…');
      await fetchState();
      if (!forced) proceed();
    } catch (e) {
      console.error('ERR:', e);
      ui.toast("You're offline or unauthorized. Showing cached/empty view.");
      proceed(true);
    } finally {
      clearTimeout(watchdog);
    }
  }

  function proceed(offlined = false) {
    if (state.booted) return;
    state.booted = true;
    ui.setStatus('ready');
    startLoop();
    if (offlined || state.timer.offline) {
      ui.toast("Couldn't reach timer. Offline mode.");
    }
  }

  // --- render loop ----------------------------------------------------------
  let raf = 0;
  function startLoop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // --- debug hook -----------------------------------------------------------
  window.appDebug = {
    state,
    refresh: async () => {
      ui.toast('Refreshing…');
      await fetchState();
      ui.toast('Refreshed');
    },
  };

  // kick it
  log('Debugger ready');
  boot();
})();