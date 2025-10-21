/* main.js — resilient boot with Supabase meta/global auto-inject + Edge support + boot hide fix */ (() => { 'use strict';

const stamp = () => [${new Date().toLocaleTimeString()}]; const log  = (...a) => console.log(stamp(), ...a); const warn = (...a) => console.warn(stamp(), 'WARN:', ...a); const $ = (q) => document.querySelector(q);

// --------------------------------------------------------------- // 🧩 Meta helpers and auto-injection if tags are missing // --------------------------------------------------------------- const hasMeta = (name) => !!document.querySelector(meta[name="${name}"]); const ensureMeta = (name, value) => { if (!hasMeta(name)) { const m = document.createElement('meta'); m.name = name; m.content = value; document.head.appendChild(m); log(Injected <meta name="${name}">); return true; } return false; };

const FALLBACK_URL  = 'https://tuqvpcevrhciursxrgav.supabase.co'; const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZwY2V2cmhjaXVyc3hyZ2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDA0NDQsImV4cCI6MjA3MjA3NjQ0NH0.JbIWJmioBNB_hN9nrLXX83u4OazV49UokvTjNB6xa_Y';

ensureMeta('supabase-url', FALLBACK_URL); ensureMeta('supabase-anon-key', FALLBACK_ANON);

const meta = (name) => document.querySelector(meta[name="${name}"])?.content?.trim(); const SUPA_URL = meta('supabase-url') || FALLBACK_URL; const SUPA_ANON = meta('supabase-anon-key') || FALLBACK_ANON;

// --------------------------------------------------------------- // 📡 Endpoints + headers // --------------------------------------------------------------- const EDGE_TIMER = ${SUPA_URL}/functions/v1/global-timer; const SB_HEADERS = { apikey: SUPA_ANON, Authorization: Bearer ${SUPA_ANON} };

// --------------------------------------------------------------- // 💻 UI helpers + boot overlay hide // --------------------------------------------------------------- const ui = { statusEl: $('#boot-status') || $('#bootMsg') || { textContent: '' }, toastBox: $('#toast') || null, setStatus(txt) { this.statusEl.textContent = txt; log('STATUS:', txt); }, toast(msg) { log('TOAST:', msg); if (!this.toastBox) return; this.toastBox.textContent = msg; this.toastBox.classList.add('show'); setTimeout(() => this.toastBox.classList.remove('show'), 2500); }, };

function hideBoot() { const el = document.getElementById('bootLoader'); if (!el) return; el.style.transition = 'opacity .25s ease'; el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }

// --------------------------------------------------------------- // 🕹 State + fetch helpers // --------------------------------------------------------------- const state = { timer: { ok: false, offline: false }, booted: false };

async function getJSON(url, opts = {}) { const r = await fetch(url, { headers: SB_HEADERS, signal: opts.signal }); if (!r.ok) throw new Error(${r.status} ${r.statusText}); return r.json(); }

const EDGE_TIMEOUT_MS = 5500; const BACKOFF_MS = [0, 1200, 2400];

async function syncTimerOnce() { if (window.EDGE_TIMER_IN_FLIGHT) return null; window.EDGE_TIMER_IN_FLIGHT = true; for (let i = 0; i < BACKOFF_MS.length; i++) { if (i > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[i])); const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort('timeout'), EDGE_TIMEOUT_MS); const t0 = performance.now(); try { const json = await getJSON(EDGE_TIMER, { signal: ctrl.signal }); log('EDGE:', 'GET', EDGE_TIMER, → 200 (${(performance.now()-t0).toFixed(0)}ms)); state.timer.ok = true; window.EDGE_TIMER_IN_FLIGHT = false; return json; } catch (err) { clearTimeout(t); const last = i === BACKOFF_MS.length - 1; warn(timer attempt #${i+1} failed, err?.message || err); if (last) { state.timer.ok = false; window.EDGE_TIMER_IN_FLIGHT = false; return null; } } } }

// --------------------------------------------------------------- // 🚀 Boot + proceed with bootLoader hide // --------------------------------------------------------------- async function boot() { ui.setStatus('initializing'); try { ui.setStatus('syncing…'); await syncTimerOnce(); proceed(); } catch (e) { warn('boot failed', e); proceed(true); } }

function proceed(offlined = false) { if (state.booted) return; state.booted = true; ui.setStatus('ready'); hideBoot(); startLoop(); }

// --------------------------------------------------------------- // ⏱ Render loop // --------------------------------------------------------------- let raf = 0; function startLoop() { cancelAnimationFrame(raf); const tick = () => { raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }

// --------------------------------------------------------------- // 🧰 Control buttons // --------------------------------------------------------------- async function callEdge(action, extra='') { const r = await fetch(${EDGE_TIMER}?action=${action}${extra}, { method:'GET' }); if (!r.ok) throw new Error(${action} → ${r.status}); return r.json(); }

$('#btnForceDecide')?.addEventListener('click', async()=>{ try{ await callEdge('advance'); await syncTimerOnce(); }catch(e){warn(e);} }); $('#btnReset30')?.addEventListener('click', async()=>{ try{ await callEdge('reset','&period=30'); await syncTimerOnce(); }catch(e){warn(e);} }); $('#btnPauseResume')?.addEventListener('click', async(ev)=>{ const b = ev.currentTarget; const s = b.dataset.state || 'run'; try { if (s==='run'){ await callEdge('pause'); b.dataset.state='pause'; b.textContent='Resume'; } else { await callEdge('resume'); b.dataset.state='run'; b.textContent='Pause'; } await syncTimerOnce(); } catch(e){ warn(e); } });

// --------------------------------------------------------------- // 🟢 Start // --------------------------------------------------------------- log('Debugger ready'); if (!window.RAGE_TIMER_PATCHED) { window.RAGE_TIMER_PATCHED = true; boot(); setInterval(syncTimerOnce, 60_000); } })();

