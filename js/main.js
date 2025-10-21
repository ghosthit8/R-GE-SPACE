/* main.js — resilient boot with Supabase meta/global auto-inject + Edge support + boot hide fix (ES5 safe wrapper) */ (function () { 'use strict';

const stamp = function() { return '[' + new Date().toLocaleTimeString() + ']'; }; const log  = function() { console.log.apply(console, [stamp()].concat(Array.from(arguments))); }; const warn = function() { console.warn.apply(console, [stamp(), 'WARN:'].concat(Array.from(arguments))); }; const $ = function(q) { return document.querySelector(q); };

// --------------------------------------------------------------- // 🧩 Meta helpers and auto-injection if tags are missing // --------------------------------------------------------------- function hasMeta(name) { return !!document.querySelector('meta[name="' + name + '"]'); } function ensureMeta(name, value) { if (!hasMeta(name)) { var m = document.createElement('meta'); m.name = name; m.content = value; document.head.appendChild(m); log('Injected <meta name="' + name + '">'); return true; } return false; }

var FALLBACK_URL  = 'https://tuqvpcevrhciursxrgav.supabase.co'; var FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y';

ensureMeta('supabase-url', FALLBACK_URL); ensureMeta('supabase-anon-key', FALLBACK_ANON);

function meta(name) { var el = document.querySelector('meta[name="' + name + '"]'); return el && el.content ? el.content.trim() : ''; }

var SUPA_URL = meta('supabase-url') || FALLBACK_URL; var SUPA_ANON = meta('supabase-anon-key') || FALLBACK_ANON;

// --------------------------------------------------------------- // 📡 Endpoints + headers // --------------------------------------------------------------- var EDGE_TIMER = SUPA_URL + '/functions/v1/global-timer'; var SB_HEADERS = { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON };

// --------------------------------------------------------------- // 💻 UI helpers + boot overlay hide // --------------------------------------------------------------- var ui = { statusEl: $('#boot-status') || $('#bootMsg') || { textContent: '' }, toastBox: $('#toast') || null, setStatus: function(txt) { this.statusEl.textContent = txt; log('STATUS:', txt); }, toast: function(msg) { log('TOAST:', msg); if (!this.toastBox) return; this.toastBox.textContent = msg; this.toastBox.classList.add('show'); setTimeout(function(){ ui.toastBox.classList.remove('show'); }, 2500); } };

function hideBoot() { var el = document.getElementById('bootLoader'); if (!el) return; el.style.transition = 'opacity .25s ease'; el.style.opacity = '0'; setTimeout(function(){ el.remove(); }, 250); }

// --------------------------------------------------------------- // 🕹 State + fetch helpers // --------------------------------------------------------------- var state = { timer: { ok: false, offline: false }, booted: false };

function getJSON(url, opts) { if (!opts) opts = {}; return fetch(url, { headers: SB_HEADERS, signal: opts.signal }).then(function(r){ if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.json(); }); }

var EDGE_TIMEOUT_MS = 5500; var BACKOFF_MS = [0, 1200, 2400];

function syncTimerOnce() { if (window.EDGE_TIMER_IN_FLIGHT) return Promise.resolve(null); window.EDGE_TIMER_IN_FLIGHT = true; var i = 0; function attempt() { if (i >= BACKOFF_MS.length) { state.timer.ok = false; window.EDGE_TIMER_IN_FLIGHT = false; return Promise.resolve(null); } var delayTime = BACKOFF_MS[i++]; return new Promise(function(resolve){ setTimeout(resolve, delayTime); }).then(function(){ var ctrl = new AbortController(); var t = setTimeout(function(){ ctrl.abort('timeout'); }, EDGE_TIMEOUT_MS); var t0 = performance.now(); return getJSON(EDGE_TIMER, { signal: ctrl.signal }).then(function(json){ log('EDGE:', 'GET', EDGE_TIMER, '→ 200 (' + (performance.now()-t0).toFixed(0) + 'ms)'); state.timer.ok = true; window.EDGE_TIMER_IN_FLIGHT = false; clearTimeout(t); return json; }).catch(function(err){ clearTimeout(t); warn('timer attempt failed', err && err.message ? err.message : err); return attempt(); }); }); } return attempt(); }

// --------------------------------------------------------------- // 🚀 Boot + proceed with bootLoader hide // --------------------------------------------------------------- function boot() { ui.setStatus('initializing'); ui.setStatus('syncing…'); syncTimerOnce().then(function(){ proceed(); }).catch(function(e){ warn('boot failed', e); proceed(true); }); }

function proceed(offlined) { if (state.booted) return; state.booted = true; ui.setStatus('ready'); hideBoot(); startLoop(); }

// --------------------------------------------------------------- // ⏱ Render loop // --------------------------------------------------------------- var raf = 0; function startLoop() { cancelAnimationFrame(raf); var tick = function(){ raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }

// --------------------------------------------------------------- // 🧰 Control buttons // --------------------------------------------------------------- function callEdge(action, extra) { if (!extra) extra = ''; return fetch(EDGE_TIMER + '?action=' + action + extra, { method:'GET' }).then(function(r){ if (!r.ok) throw new Error(action + ' → ' + r.status); return r.json(); }); }

var btnFD = $('#btnForceDecide'); if (btnFD) btnFD.addEventListener('click', function(){ callEdge('advance').then(syncTimerOnce).catch(warn); });

var btnR = $('#btnReset30'); if (btnR) btnR.addEventListener('click', function(){ callEdge('reset','&period=30').then(syncTimerOnce).catch(warn); });

var btnP = $('#btnPauseResume'); if (btnP) btnP.addEventListener('click', function(ev){ var b = ev.currentTarget; var s = b.dataset.state || 'run'; if (s==='run') { callEdge('pause').then(function(){ b.dataset.state='pause'; b.textContent='Resume'; }).then(syncTimerOnce).catch(warn); } else { callEdge('resume').then(function(){ b.dataset.state='run'; b.textContent='Pause'; }).then(syncTimerOnce).catch(warn); } });

// --------------------------------------------------------------- // 🟢 Start // --------------------------------------------------------------- log('Debugger ready'); if (!window.RAGE_TIMER_PATCHED) { window.RAGE_TIMER_PATCHED = true; boot(); setInterval(syncTimerOnce, 60000); } })();

