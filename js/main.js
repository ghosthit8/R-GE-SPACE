/* main.js — resilient boot with Supabase meta/global auto-inject + Edge support
   - Suppress fallback warning if we injected meta ourselves
   - Delay timer toast to avoid false alarms
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

  // Track if these existed before we touch them (so we only warn if truly missing)
  const hadMetaUrl  = hasMeta('supabase-url');
  const hadMetaAnon = hasMeta('supabase-anon-key');

  // If you prefer to control these in index.html, add the meta tags there and remove these two lines:
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

  // Only warn if we’re truly using fallbacks the user didn’t provide
  const usingFallbacks = (SUPA_URL === FALLBACK_URL) || (SUPA_ANON === FALLBACK_ANON);
  const userProvidedGlobals = !!(window.SUPABASE_URL || window.SUPABASE_ANON_KEY);
  const userProvidedMeta    = hadMetaUrl || hadMetaAnon; // present before our injection
  if (usingFallbacks && !userProvidedGlobals && !userProvidedMeta) {
    // We injected fallbacks intentionally—no need to warn loudly.
    // If you want a hard warning instead, uncomment next line:
    // warn('Supabase anon key not found via meta/global; using fallback constant.');
  }

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

  // ---------------------------------------------------------------
  // 🔧 Small utils
  // ---------------------------------------------------------------
  const withTimeout = (p, ms, onTimeout) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        onTimeout?.();
        resolve({ __timeout: true });
      }, ms);
      p.then((v) => { clearTimeout(t); resolve(v); })
       .catch((e) => { clearTimeout(t); reject(e); });
    });

  async function getJSON(url, opts = {}) {
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

  // ---------------------------------------------------------------
  // 🕹 State + fetchers
  // ---------------------------------------------------------------
  const state = {
    timer: { ok: false, lastEdgeIso: null, offline: false },
    winners: new Set(),
    votesTotal: 0,
    booted: false,
  };

  async function probeEdgeTimer() {
    const res = await withTimeout(
      getJSON(EDGE_TIMER),
      3000,
      () => { state.timer.offline = true; }
    );
    if (!res || res.__timeout) return;
    state.timer.ok = true;
    state.timer.offline = false;
    state.timer.lastEdgeIso = res?.now || null;
  }

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
    const timerP = probeEdgeTimer(); // don’t await; let it resolve in background

    const [w1, w2, w3, w4] = await winnersP;
    const votes = await votesP;

    state.winners = new Set(
      [...w1, ...w2, ...w3, ...w4].map((r) => r.phase_key).filter(Boolean)
    );
    state.votesTotal = Array.isArray(votes) ? votes.length : 0;

    timerP.catch(() => { state.timer.offline = true; });
  }

  // ---------------------------------------------------------------
  // 🚀 Boot sequence
  // ---------------------------------------------------------------
  async function boot() {
    ui.setStatus('initializing');
    let forced = false;

    // If network slow, proceed without waiting for timer
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

    // Delay the timer toast slightly; skip if timer becomes OK shortly
    setTimeout(() => {
      if (offlined) return ui.toast("Couldn't reach timer. Offline mode.");
      if (!state.timer.ok) ui.toast("Couldn't reach timer. Offline mode.");
    }, 900);
  }

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
      ui.toast('Refreshed');
    },
  };

  // ---------------------------------------------------------------
  // 🟢 Start
  // ---------------------------------------------------------------
  log('Debugger ready');
  boot();
})(); // EOF