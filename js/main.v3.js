/* main.js — resilient boot with Supabase meta/global auto-inject + Edge support + boot hide fix (ES5 safe wrapper) */
(function () {
  'use strict';

  // ---- tiny logger helpers (ES5-safe) ----
  function stamp(){ return '[' + new Date().toLocaleTimeString() + ']'; }
  function log(){ var a=[stamp()]; for(var i=0;i<arguments.length;i++) a.push(arguments[i]); console.log.apply(console,a); }
  function warn(){ var a=[stamp(),'WARN:']; for(var i=0;i<arguments.length;i++) a.push(arguments[i]); console.warn.apply(console,a); }
  function $(q){ return document.querySelector(q); }

  // ---------------------------------------------------------------
  // 🧩 Meta helpers and auto-injection if tags are missing
  // ---------------------------------------------------------------
  function hasMeta(name){ return !!document.querySelector('meta[name="'+name+'"]'); }
  function ensureMeta(name, value){
    if (!hasMeta(name)) {
      var m = document.createElement('meta');
      m.name = name;
      m.content = value;
      document.head.appendChild(m);
      log('Injected <meta name="'+name+'">');
      return true;
    }
    return false;
  }

  var FALLBACK_URL  = 'https://tuqvpcevrhciursxrgav.supabase.co';
  var FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y';

  ensureMeta('supabase-url', FALLBACK_URL);
  ensureMeta('supabase-anon-key', FALLBACK_ANON);

  function meta(name){
    var el = document.querySelector('meta[name="'+name+'"]');
    return el && el.content ? el.content.trim() : '';
  }

  var SUPA_URL = meta('supabase-url') || FALLBACK_URL;
  var SUPA_ANON = meta('supabase-anon-key') || FALLBACK_ANON;

  // ---------------------------------------------------------------
  // 📡 Endpoints + headers
  // ---------------------------------------------------------------
  var EDGE_TIMER = SUPA_URL + '/functions/v1/global-timer';
  var SB_HEADERS = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON };

  // ---------------------------------------------------------------
  // 💻 UI helpers + boot overlay hide
  // ---------------------------------------------------------------
  var ui = {
    statusEl: $('#boot-status') || $('#bootMsg') || { textContent: '' },
    toastBox: $('#toast') || null,
    setStatus: function(txt){ this.statusEl.textContent = txt; log('STATUS:', txt); },
    toast: function(msg){
      log('TOAST:', msg);
      if (!this.toastBox) return;
      this.toastBox.textContent = msg;
      this.toastBox.classList.add('show');
      setTimeout(function(){ ui.toastBox.classList.remove('show'); }, 2500);
    }
  };

  function hideBoot(){
    var el = document.getElementById('bootLoader');
    if (!el) return;
    el.style.transition = 'opacity .25s ease';
    el.style.opacity = '0';
    setTimeout(function(){ if (el && el.parentNode) el.parentNode.removeChild(el); }, 250);
  }

  // ---------------------------------------------------------------
  // 🕹 State + fetch helpers
  // ---------------------------------------------------------------
  var state = { timer: { ok: false, offline: false }, booted: false };

  function getJSON(url, opts){
    if (!opts) opts = {};
    var headers = SB_HEADERS;
    return fetch(url, { method:'GET', headers: headers, signal: opts.signal })
      .then(function(r){
        if (!r.ok) return r.text().then(function(t){ throw new Error(r.status+' '+r.statusText+' '+t); });
        return r.json();
      });
  }

  var EDGE_TIMEOUT_MS = 5500;
  var BACKOFF_MS = [0, 1200, 2400];

  function syncTimerOnce(){
    if (window.__EDGE_TIMER_IN_FLIGHT__) return Promise.resolve(null);
    window.__EDGE_TIMER_IN_FLIGHT__ = true;

    var i = 0;
    function attempt(){
      if (i >= BACKOFF_MS.length){
        state.timer.ok = false;
        window.__EDGE_TIMER_IN_FLIGHT__ = false;
        return Promise.resolve(null);
      }
      var delayTime = BACKOFF_MS[i++];
      return new Promise(function(res){ setTimeout(res, delayTime); }).then(function(){
        var ctrl = new AbortController();
        var t = setTimeout(function(){ try{ ctrl.abort('timeout'); }catch(_){} }, EDGE_TIMEOUT_MS);
        var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
        return getJSON(EDGE_TIMER, { signal: ctrl.signal }).then(function(json){
          var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
          log('EDGE:', 'GET', EDGE_TIMER, '→ 200 (' + (t1 - t0).toFixed(0) + 'ms)');
          state.timer.ok = true;
          clearTimeout(t);
          window.__EDGE_TIMER_IN_FLIGHT__ = false;
          // Hook here if you render countdowns:
          // window.applyBaseAndPeriod && window.applyBaseAndPeriod(json.state || json);
          return json;
        }).catch(function(err){
          clearTimeout(t);
          warn('timer attempt failed', err && err.message ? err.message : err);
          return attempt();
        });
      });
    }
    return attempt();
  }

  // ---------------------------------------------------------------
  // 🚀 Boot + proceed with bootLoader hide
  // ---------------------------------------------------------------
  function boot(){
    ui.setStatus('initializing');
    ui.setStatus('syncing…');
    syncTimerOnce().then(function(){
      proceed(false);
    }).catch(function(e){
      warn('boot failed', e);
      proceed(true);
    });
  }

  function proceed(offlined){
    if (state.booted) return;
    state.booted = true;
    ui.setStatus('ready');
    hideBoot();
    startLoop();
    if (offlined) ui.toast("Couldn't reach timer. Offline mode.");
  }

  // ---------------------------------------------------------------
  // ⏱ Render loop
  // ---------------------------------------------------------------
  var raf = 0;
  function startLoop(){
    if (raf) cancelAnimationFrame(raf);
    function tick(){ raf = requestAnimationFrame(tick); }
    raf = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------
  // 🧰 Control buttons (advance/reset/pause/resume)
  // ---------------------------------------------------------------
  function callEdge(action, extra){
    if (!extra) extra = '';
    var url = EDGE_TIMER + '?action=' + action + extra;
    return fetch(url, { method:'GET' }).then(function(r){
      if (!r.ok) throw new Error(action + ' → ' + r.status);
      return r.json();
    }).then(function(j){
      // window.applyBaseAndPeriod && window.applyBaseAndPeriod(j.state || j);
      return j;
    });
  }

  var btnFD = $('#btnForceDecide');
  if (btnFD) btnFD.addEventListener('click', function(){
    callEdge('advance').then(function(){ return syncTimerOnce(); }).catch(function(e){ warn(e); });
  });

  var btnR = $('#btnReset30');
  if (btnR) btnR.addEventListener('click', function(){
    callEdge('reset','&period=30').then(function(){ return syncTimerOnce(); }).catch(function(e){ warn(e); });
  });

  var btnP = $('#btnPauseResume');
  if (btnP) btnP.addEventListener('click', function(ev){
    var b = ev.currentTarget;
    var s = b.dataset.state || 'run';
    if (s === 'run'){
      callEdge('pause').then(function(){
        b.dataset.state = 'pause';
        b.textContent = 'Resume';
      }).then(function(){ return syncTimerOnce(); }).catch(function(e){ warn(e); });
    } else {
      callEdge('resume').then(function(){
        b.dataset.state = 'run';
        b.textContent = 'Pause';
      }).then(function(){ return syncTimerOnce(); }).catch(function(e){ warn(e); });
    }
  });

  // ---------------------------------------------------------------
  // 🟢 Start
  // ---------------------------------------------------------------
  log('Debugger ready');
  if (!window.__RAGE_TIMER_PATCHED__) {
    window.__RAGE_TIMER_PATCHED__ = true;
    boot();
    setInterval(syncTimerOnce, 60000);
  }
})();