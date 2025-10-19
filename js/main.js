/* main.js — resilient boot + Supabase auth headers */
(() => {
  const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
  const $ = (q) => document.querySelector(q);

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

  // --- config ---------------------------------------------------------------
  const SUPA_URL = 'https://tuqvpcevrhciursxrgav.supabase.co';
  const SUPA_ANON = '<YOUR_SUPABASE_ANON_KEY>'; // <-- paste your anon public key
  const BASE_HEADERS = {
    apikey: SUPA_ANON,
    Authorization: `Bearer ${SUPA_ANON}`,
  };

  const WINNERS = (keys) =>
    `${SUPA_URL}/rest/v1/winners?select=phase_key&phase_key=in.%28${keys.map(encodeURIComponent).join('%2C')}%29`;
  const VOTES = `${SUPA_URL}/rest/v1/phase_votes?select=vote`;
  const EDGE_TIMER = `${SUPA_URL}/functions/v1/global-timer`;

  // --- small utils ----------------------------------------------------------
  const withTimeout = (p, ms, onTimeout) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        onTimeout?.();
        resolve({ __timeout: true });
      }, ms);
      p.then((v) => { clearTimeout(t); resolve(v); })
       .catch((e) => { clearTimeout(t); reject(e); });
    });

  async function getJSON(url) {
    const r = await fetch(url, {
      credentials: 'omit',
      mode: 'cors',
      headers: BASE_HEADERS,
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
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
      fetch(EDGE_TIMER, {
        credentials: 'omit',
        mode: 'cors',
        headers: BASE_HEADERS,
      }).then((r) => (r.ok ? r.json() : null)),
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
    const sf = ['sf1', 'sf2'];
    const qf = ['qf1', 'qf2', 'qf3', 'qf4'];
    const r16 = Array.from({ length: 8 }, (_, i) => `r16_${i + 1}`);
    const r32 = Array.from({ length: 16 }, (_, i) => `r32_${i + 1}`);

    const winnersP = Promise.all([
      getJSON(WINNERS(sf)),
      getJSON(WINNERS(qf)),
      getJSON(WINNERS(r16)),
      getJSON(WINNERS(r32)),
    ]);
    const votesP = getJSON(VOTES);
    const timerP = probeEdgeTimer(); // non-blocking

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
      await fetchState(); // winners + votes are the only blockers now
      if (!forced) proceed();
    } catch (e) {
      console.error('ERR:', e);
      ui.toast("You're offline. Showing cached/empty view.");
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
      // update anything time-based here (use Date.now() if timer missing)
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