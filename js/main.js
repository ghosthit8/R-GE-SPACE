/* main.js — resilient boot with Supabase auth headers */
(() => {
  // ---------- tiny logger ----------
  const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
  const $   = (q) => document.querySelector(q);

  // ---------- read config (URL + anon key) ----------
  // Prefer <meta> tags, then fall back to window globals if you set them in a script tag
  // <meta name="supabase-url" content="https://YOUR-REF.supabase.co">
  // <meta name="supabase-anon-key" content="eyJhbGciOi...">
  const META = {
    url : document.querySelector('meta[name="supabase-url"]')?.content?.trim(),
    key : document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim(),
  };

  // If you didn’t add meta tags, you can define these before loading main.js:
  //   <script>
  //     window.SUPABASE_URL = 'https://tuqvpcevrhciursxrgav.supabase.co';
  //     window.SUPABASE_ANON_KEY = 'eyJhbGciOiJI...';
  //   </script>
  const SUPA_URL = META.url || window.SUPABASE_URL || 'https://tuqvpcevrhciursxrgav.supabase.co';
  const SUPA_KEY = META.key || window.SUPABASE_ANON_KEY || '';

  if (!SUPA_KEY) {
    console.warn('Supabase anon key not found. Add a <meta name="supabase-anon-key"> or set window.SUPABASE_ANON_KEY before main.js.');
  }

  // ---------- endpoints ----------
  const WINNERS = (keys) =>
    `${SUPA_URL}/rest/v1/winners?select=phase_key&phase_key=in.(${keys.map(encodeURIComponent).join(',')})`;
  const VOTES      = `${SUPA_URL}/rest/v1/phase_votes?select=vote`;
  const EDGE_TIMER = `${SUPA_URL}/functions/v1/global-timer`;

  // ---------- UI helpers ----------
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

  // ---------- utils ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const withTimeout = (p, ms, onTimeout) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        onTimeout?.();
        resolve({ __timeout: true });
      }, ms);
      p.then((v) => {
        clearTimeout(t);
        resolve(v);
      }).catch((e) => {
        clearTimeout(t);
        reject(e);
      });
    });

  // Unified fetch with auth headers for Supabase (REST & Functions)
  async function getJSON(url, { auth = true, method = 'GET', body = null } = {}) {
    const headers = {
      Accept: 'application/json',
    };
    if (auth && SUPA_KEY) {
      headers['apikey'] = SUPA_KEY;
      headers['Authorization'] = `Bearer ${SUPA_KEY}`;
    }
    if (body != null) {
      headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      credentials: 'omit',
      mode: 'cors',
    });
    if (!r.ok) {
      // Bubble the status so your logger shows 401/403 etc.
      const text = await r.text().catch(() => '');
      throw new Error(`${r.status} ${r.statusText}${text ? ` - ${text}` : ''}`);
    }
    // Some functions might return empty
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return {};
    return r.json();
  }

  // ---------- app state ----------
  const state = {
    timer: { ok: false, lastEdgeIso: null, offline: false },
    winners: new Set(),
    votesTotal: 0,
    booted: false,
  };

  // ---------- non-blocking timer probe (Edge Function) ----------
  async function probeEdgeTimer() {
    const res = await withTimeout(
      // Edge Functions usually require the same Bearer token
      getJSON(EDGE_TIMER, { auth: true }),
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

  // ---------- fetch game state ----------
  async function fetchState() {
    const sf  = ['sf1', 'sf2'];
    const qf  = ['qf1', 'qf2', 'qf3', 'qf4'];
    const r16 = Array.from({ length: 8 },  (_, i) => `r16_${i + 1}`);
    const r32 = Array.from({ length: 16 }, (_, i) => `r32_${i + 1}`);

    // Kick off everything at once (all with auth headers)
    const winnersP = Promise.all([
      getJSON(WINNERS(sf)),
      getJSON(WINNERS(qf)),
      getJSON(WINNERS(r16)),
      getJSON(WINNERS(r32)),
    ]);
    const votesP  = getJSON(VOTES);           // REST
    const timerP  = probeEdgeTimer();         // Edge Function, runs in background

    const [w1, w2, w3, w4] = await winnersP;
    const votes = await votesP;

    state.winners = new Set(
      [...w1, ...w2, ...w3, ...w4].map((r) => r.phase_key).filter(Boolean)
    );
    state.votesTotal = Array.isArray(votes) ? votes.length : 0;

    timerP.catch(() => {
      state.timer.offline = true;
    });
  }

  // ---------- boot with watchdog ----------
  async function boot() {
    log('Debugger ready');
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

  // ---------- render loop ----------
  let raf = 0;
  function startLoop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      // time-based updates here if needed
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ---------- debug hook ----------
  window.appDebug = {
    state,
    refresh: async () => {
      ui.toast('Refreshing…');
      await fetchState();
      ui.toast('Refreshed');
    },
  };

  // go
  boot();
})();