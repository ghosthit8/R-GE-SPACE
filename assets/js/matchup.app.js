// matchup.app.js — v2 fixed for Edge payload (baseISO/clock/decision_seconds)
import { SUPABASE_URL, SUPABASE_ANON, EDGE_URL } from './matchup.config.js';

// Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// STATE
let currentUid = null;
let cycleStart = null;         // baseISO from Edge
let periodSec = 30;
let lastCheckpoint = 0;        // 0..5 (if Edge returns it)
let paused = false;

let activeSlot = 'r32_1';
let currentStage = 'r32';

// --- advancers cache (phase_key -> color) ---
let advancers = new Map();

// DOM
const $ = (id)=>document.getElementById(id);
const clockEl    = $('clock');
const phaseBadge = $('phaseBadge');
const loginBadge = $('loginBadge');
const voteA      = $('voteA');
const voteB      = $('voteB');
const imgA       = $('imgA');
const imgB       = $('imgB');
const countA     = $('countA');
const countB     = $('countB');
const submitBtn  = $('submitBtn');
const btnPause   = $('btnPause');
const btnReset   = $('btnReset');
const brows      = $('brows');
const overlay    = $('overlay');
const overlayImg = $('overlayImg');
const overlayNote= $('overlayNote');

// helpers
const stageOf    = (slot)=> slot.startsWith('r32')?'r32':slot.startsWith('r16')?'r16':slot.startsWith('qf')?'qf':(slot.startsWith('sf')?'sf':'final');
const stageLevel = (s)=> s==='r32'?1:s==='r16'?2:s==='qf'?3:s==='sf'?4:5;
const slotLevel  = (slot)=> stageLevel(stageOf(slot));
function baseForSlot(){ return cycleStart; }
function slotKey(slot, base){ return slot==='final' ? `${base}::final` : `${base}::${slot}`; }
function seedUrlFromKey(baseISO, suffix){ const s=encodeURIComponent(`${baseISO}-${suffix}`); return `https://picsum.photos/seed/${s}/1600/1200`; }
function r32Pack(baseISO, n){ return { A: seedUrlFromKey(baseISO, `A${n}`), B: seedUrlFromKey(baseISO, `B${n}`) }; }

// --- load advancers for the current base ---
async function loadAdvancers(baseISO){
  if (!baseISO){ advancers = new Map(); return; }
  const url =
    `${SUPABASE_URL}/rest/v1/advancers_v2`
    + `?select=phase_key,color,from_key&base_iso=eq.${encodeURIComponent(baseISO)}`;
  const rows = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  }).then(r => r.ok ? r.json() : []);
  advancers = new Map((rows || []).map(r => [r.phase_key, String(r.color || '').toLowerCase()]));
  window.RageDebug?.log?.('advancers loaded', advancers.size);
}

async function getPairFromWinners(baseISO, leftKey, rightKey, rebuildLeft, rebuildRight){
  const { data } = await supabase.from('winners_v2').select('phase_key,color').in('phase_key', [leftKey, rightKey]);
  const map = Object.fromEntries((data||[]).map(r=>[r.phase_key, String(r.color||'').toLowerCase()]));
  if (!(map[leftKey] && map[rightKey])) return null;
  const L = await rebuildLeft();  const R = await rebuildRight();
  const leftSrc  = (map[leftKey]==='red') ? L.A : L.B;
  const rightSrc = (map[rightKey]==='red') ? R.A : R.B;
  return { A: leftSrc, B: rightSrc };
}

async function packFor(slot){
  const base = baseForSlot();
  if (!base) return null;

  if (slot.startsWith('r32')){
    const n = Number(slot.split('_')[1]);
    return r32Pack(base, n);
  }

  if (slot.startsWith('r16')){
    const i = Number(slot.split('_')[1]);
    const pair = [i*2-1, i*2];
    const k1 = `${base}::r32_${pair[0]}`, k2 = `${base}::r32_${pair[1]}`;
    const rebuild = (n)=>()=> Promise.resolve(r32Pack(base, n));
    return await getPairFromWinners(base, k1, k2, rebuild(pair[0]), rebuild(pair[1]));
  }

  if (slot.startsWith('qf')){
    const map = {qf1:[1,2], qf2:[3,4], qf3:[5,6], qf4:[7,8]}[slot];
    const k1 = `${base}::r16_${map[0]}`, k2 = `${base}::r16_${map[1]}`;
    const rebuild = (n)=>()=> packFor(`r16_${n}`);
    return await getPairFromWinners(base, k1, k2, rebuild(map[0]), rebuild(map[1]));
  }

  if (slot.startsWith('sf')){
    const map = slot==='sf1' ? ['qf1','qf2'] : ['qf3','qf4'];
    const k1 = `${base}::${map[0]}`, k2 = `${base}::${map[1]}`;
    const rebuild = (s)=>()=> packFor(s);
    return await getPairFromWinners(base, k1, k2, rebuild(map[0]), rebuild(map[1]));
  }

  const k1 = `${base}::sf1`, k2 = `${base}::sf2`;
  const rebuild = (s)=>()=> packFor(s);
  return await getPairFromWinners(base, k1, k2, rebuild('sf1'), rebuild('sf2'));
}

async function countVotes(key){
  const { data } = await supabase.from('phase_votes_v2').select('vote').eq('phase_key', key);
  let r=0,b=0; (data||[]).forEach(v=>{ if(v.vote==='red') r++; else if(v.vote==='blue') b++; });
  return {r,b};
}

export async function paintSlot(slot){
  const base = baseForSlot();
  if (!base) return;
  $('phaseBadge').textContent = `phase: ${base}`;
  const pack = await packFor(slot);
  if (pack){ imgA.src = pack.A; imgB.src = pack.B; } else { imgA.removeAttribute('src'); imgB.removeAttribute('src'); }
  const key = slotKey(slot, base);
  const {r,b} = await countVotes(key);
  $('countA').textContent = `${r} vote${r===1?'':'s'}`;
  $('countB').textContent = `${b} vote${b===1?'':'s'}`;
  window.RageDebug?.markCounts?.(slot, r, b);
}

async function renderBracket(){
  const base = cycleStart;
  if (!base){ brows.innerHTML=''; return; }

  // refresh advancers before painting the list
  await loadAdvancers(base);

  const order = [
    'r32_1','r32_2','r32_3','r32_4','r32_5','r32_6','r32_7','r32_8',
    'r32_9','r32_10','r32_11','r32_12','r32_13','r32_14','r32_15','r32_16',
    'r16_1','r16_2','r16_3','r16_4','r16_5','r16_6','r16_7','r16_8',
    'qf1','qf2','qf3','qf4','sf1','sf2','final'
  ];
  const blocks = await Promise.all(order.map(async s=>{
    const p = await packFor(s);
    const key = slotKey(s, base);
    const {r,b} = await countVotes(key).catch(()=>({r:0,b:0}));
    const decided = advancers.has(key) ? 'decided' : '';
    return `
      <div class="brow ${decided}" data-slot="${s}">
        <div class="bbadge">${stageOf(s).toUpperCase()}</div>
        <div style="display:flex;gap:8px">
          <div class="thumb">${p?.A ? `<img src="${p.A}" alt="">` : ''}</div>
          <div class="thumb">${p?.B ? `<img src="${p.B}" alt="">` : ''}</div>
        </div>
        <div class="bmeta"><div class="title">${s}</div></div>
        <div class="bscore">${r} - ${b}</div>
      </div>`;
  }));
  brows.innerHTML = blocks.join('');
  brows.querySelectorAll('.brow').forEach(row=>{
    row.addEventListener('click', async ()=>{
      activeSlot = row.dataset.slot;
      await paintSlot(activeSlot);
    });
  });
}

async function setAuth(){
  const { data:{session} } = await supabase.auth.getSession();
  currentUid = session?.user?.id || null;
  loginBadge.textContent = currentUid ? 'logged in' : 'not logged in';
}

// ---- FIXED: map Edge GET → UI fields; bootstrap if no base ----
async function fetchState(){
  const res  = await fetch(EDGE_URL, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }});
  const body = await res.json();

  // New Edge payload (no {state:{…}})
  cycleStart = body.baseISO || null;
  periodSec  = Number(body.decision_seconds ?? periodSec ?? 30);
  if (typeof body.last_checkpoint === 'number') lastCheckpoint = body.last_checkpoint;
  if (typeof body.paused === 'boolean') paused = body.paused;
  if (typeof body.clock === 'number') clockEl.textContent = String(Math.floor(body.clock));

  // optional stage derivation if checkpoint present
  if (typeof lastCheckpoint === 'number') {
    currentStage = ['r32','r16','qf','sf','final'][Math.max(0, lastCheckpoint)-1] || currentStage || 'r32';
  }

  // If there is still no active base, POST once to start, then re-fetch
  if (!cycleStart) {
    await fetch(EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      body: JSON.stringify({})
    });
    const again = await fetch(EDGE_URL, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }});
    const body2 = await again.json();
    cycleStart = body2.baseISO || null;
    if (typeof body2.clock === 'number') clockEl.textContent = String(Math.floor(body2.clock));
  }
}

function lockUI(){
  phaseBadge.textContent = cycleStart ? `phase: ${cycleStart}` : 'phase: —';
  const locked = (stageLevel(stageOf(activeSlot)) !== stageLevel(currentStage));
  [voteA, voteB, submitBtn].forEach(b=> b.disabled = locked || !currentUid);
}

async function postAction(action){
  await fetch(EDGE_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', apikey:SUPABASE_ANON, Authorization:`Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify({action})
  });
  await fetchState();
}

function wireControls(){
  $('overlayClose').onclick = ()=> overlay.classList.remove('show');
  $('btnPause').onclick = async ()=> postAction(paused ? 'resume':'pause');
  $('btnReset').onclick = async ()=> { await postAction('reset'); await paintSlot(activeSlot); await renderBracket(); };

  let chosen=null;
  $('voteA').onclick=()=>{ chosen='red';  voteA.classList.add('selected'); voteB.classList.remove('selected'); submitBtn.disabled=!currentUid; };
  $('voteB').onclick=()=>{ chosen='blue'; voteB.classList.add('selected'); voteA.classList.remove('selected'); submitBtn.disabled=!currentUid; };
  $('submitBtn').onclick=async ()=>{
    if (!chosen) return;
    if (!currentUid) return alert('Log in to vote');
    const key = slotKey(activeSlot, baseForSlot());
    await supabase.from('phase_votes_v2').upsert({ phase_key: key, user_id: currentUid, vote: chosen }, { onConflict:'phase_key,user_id' });
    await paintSlot(activeSlot);
    submitBtn.textContent='✔ Voted'; submitBtn.disabled=true;
  };
}

function wireRealtime(){
  supabase.channel('v2-votes')
    .on('postgres_changes',{event:'*',schema:'public',table:'phase_votes_v2'}, async ()=>{
      await paintSlot(activeSlot);
    }).subscribe();

  supabase.channel('v2-winners')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'winners_v2'}, (payload)=>{
      const pk = payload?.new?.phase_key || '';
      if (pk.endsWith('::final') && pk.startsWith(cycleStart)){
        const color = (payload?.new?.color||'').toLowerCase();
        overlayNote.textContent = color === 'red' ? 'Left side triumphs.' : 'Right side triumphs.';
        overlayImg.src = color==='red' ? imgA.src : imgB.src;
        overlay.classList.add('show');
      }
    }).subscribe();
}

async function boot(){
  await setAuth();
  supabase.auth.onAuthStateChange((_evt, session)=>{
    currentUid = session?.user?.id || null;
    loginBadge.textContent = currentUid ? 'logged in' : 'not logged in';
    lockUI();
  });

  await fetchState();
  lockUI();

  // ensure advancers are available before first paints
  await loadAdvancers(cycleStart);

  await paintSlot(activeSlot);
  await renderBracket();

  // tick
  (async function tick(){
    try{
      await fetchState();
      lockUI();
      await loadAdvancers(cycleStart);
    }catch{}
    setTimeout(tick, 1000);
  })();

  wireControls();
  wireRealtime();
}

// expose for debugger helpers
window.__matchup__ = { paintSlot, fetchState, advancers };

// start app when DOM is ready (wrapper must come AFTER boot is defined)
function startWhenReady(){
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
startWhenReady();