// matchup.app.js — v2.5 (debug-instrumented voting path)
// Source baseline: v2.4 with 100s cycle / 20s checkpoints
// Changes: Added robust logging around vote upsert, countVotes(), realtime, and decide boundaries.

import { SUPABASE_URL, SUPABASE_ANON, EDGE_URL } from './matchup.config.js';

// ---- TABLES (centralized) ----
const TABLE_VOTES     = 'phase_votes_v2';
const TABLE_WINNERS   = 'winners_v2';
const TABLE_ADVANCERS = 'advancers_v2';

// ---- Supabase ----
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- SCHEDULE ----
const CYCLE_SEC = 100; // total cycle length
const STEP_SEC  = 20;  // decision cadence (every 20s)

// ---- STATE ----
let currentUid = null;
let cycleStart = null;   // base ISO for current tournament cycle
let paused = false;

let activeSlot = 'r32_1';
let currentStage = 'r32';    // r32 -> r16 -> qf -> sf -> final
let usedLocalFallback = false;

// advancers cache (phase_key -> color)
let advancers = new Map();

// checkpoint watcher (to only fire once per boundary)
let lastCheckpointIndex = null;

// ---- DOM ----
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

// ---- Helpers / Debug ----
const stageOf    = (slot)=> slot.startsWith('r32')?'r32':slot.startsWith('r16')?'r16':slot.startsWith('qf')?'qf':(slot.startsWith('sf')?'sf':'final');
const stageOrder = ['r32','r16','qf','sf','final'];

function note(...a){ try{ window.RageDebug?.log?.(...a); }catch{} }
function d(tag, obj){ // ultra-safe debug logger
  const time = new Date().toLocaleTimeString();
  try {
    window.RageDebug?.log?.(`[${time}] ${tag}`, obj ?? '');
  } catch {}
  try {
    console.log(`[${time}] ${tag}`, obj ?? '');
  } catch {}
}

function slotKey(slot, base){ return slot==='final' ? `${base}::final` : `${base}::${slot}`; }
function seedUrlFromKey(baseISO, suffix){ const s=encodeURIComponent(`${baseISO}-${suffix}`); return `https://picsum.photos/seed/${s}/1600/1200`; }
function r32Pack(baseISO, n){ return { A: seedUrlFromKey(baseISO, `A${n}`), B: seedUrlFromKey(baseISO, `B${n}`) }; }

// ---------- TIME / STAGE DERIVATION ----------
function secondsSinceBase(baseISO){
  const baseMs = Date.parse(baseISO);
  const nowMs  = Date.now();
  return Math.max(0, Math.floor((nowMs - baseMs)/1000));
}

function leftFromBase(baseISO){
  if (!baseISO) return null;
  const elapsed = secondsSinceBase(baseISO) % CYCLE_SEC; // 0..99
  let left = (CYCLE_SEC - elapsed) % CYCLE_SEC;          // 0..99 (0 means boundary)
  // Show 100 at the start boundary so the clock *starts at 100*
  if (left === 0) left = CYCLE_SEC;                      // 100..1
  return left;
}

// Which tournament stage should be active given seconds-left
function stageForLeft(left){
  // (80,100] r32; (60,80] r16; (40,60] qf; (20,40] sf; (0,20] final
  if (left > 80) return 'r32';
  if (left > 60) return 'r16';
  if (left > 40) return 'qf';
  if (left > 20) return 'sf';
  return 'final';
}

// Fire server “decide” at each 20s boundary exactly once
async function maybeDecide(left){
  if (!cycleStart || paused || left == null) return;
  // Convert left to “elapsed within cycle”, 0..99 (but we display left as 100..1)
  const elapsed = (CYCLE_SEC - (left % CYCLE_SEC)) % CYCLE_SEC; // 0..99
  // Index 0..5 for checkpoints at 100,80,60,40,20,0 seconds-left
  const checkpointIndex = Math.floor(elapsed / STEP_SEC); // 0..4 during the cycle; wraps at next cycle

  const atBoundary = (elapsed % STEP_SEC) === 0; // exactly at 0,20,40,60,80 elapsed
  const isStartOfCycle = (elapsed === 0);        // skip “decide” at cycle start

  if (atBoundary && !isStartOfCycle && checkpointIndex !== lastCheckpointIndex){
    lastCheckpointIndex = checkpointIndex;
    d('DECIDE → POST /edge', {elapsed, checkpointIndex});
    try {
      await postAction('decide'); // server computes winners/advancers for the round gate we just passed
    } catch(e){
      d('DECIDE post failed', e);
    }
  }

  // When we roll over to a new cycle (left jumps from ~1 back to 100), reset the tracker
  if (isStartOfCycle) {
    d('Cycle rollover detected; reset checkpoint tracker', {});
    lastCheckpointIndex = null;
  }
}

// ---------- DATA HELPERS ----------
async function loadAdvancers(baseISO){
  if (!baseISO){ advancers = new Map(); return; }
  const url =
    `${SUPABASE_URL}/rest/v1/${TABLE_ADVANCERS}`
    + `?select=phase_key,color,from_key&base_iso=eq.${encodeURIComponent(baseISO)}`;
  const rows = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  }).then(r => r.ok ? r.json() : []);
  advancers = new Map((rows || []).map(r => [r.phase_key, String(r.color || '').toLowerCase()]));
  d('Advancers cache loaded', {count:(rows||[]).length});
}

async function getPairFromWinners(baseISO, leftKey, rightKey, rebuildLeft, rebuildRight){
  const { data, error } = await supabase
    .from(TABLE_WINNERS)
    .select('phase_key,color')
    .in('phase_key', [leftKey, rightKey]);

  if (error) d('getPairFromWinners: select error', error);
  const map = Object.fromEntries((data||[]).map(r=>[r.phase_key, String(r.color||'').toLowerCase()]));
  if (!(map[leftKey] && map[rightKey])) return null;
  const L = await rebuildLeft();  const R = await rebuildRight();
  const leftSrc  = (map[leftKey]==='red') ? L.A : L.B;
  const rightSrc = (map[rightKey]==='red') ? R.A : R.B;
  return { A: leftSrc, B: rightSrc };
}

async function packFor(slot){
  const base = cycleStart;
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
  const { data, error } = await supabase.from(TABLE_VOTES).select('vote').eq('phase_key', key);
  if (error){ d('countVotes error', {key, error}); return {r:0,b:0}; }
  let r=0,b=0; (data||[]).forEach(v=>{ if(v.vote==='red') r++; else if(v.vote==='blue') b++; });
  d('countVotes', {key, r, b, total:(data||[]).length});
  return {r,b};
}

// ---------- UI PAINT ----------
export async function paintSlot(slot){
  const base = cycleStart;
  if (!base) return;
  const pack = await packFor(slot);
  if (pack){ imgA.src = pack.A; imgB.src = pack.B; } else { imgA.removeAttribute('src'); imgB.removeAttribute('src'); }
  const key = slotKey(slot, base);
  const {r,b} = await countVotes(key);
  $('countA').textContent = `${r} vote${r===1?'':'s'}`;
  $('countB').textContent = `${b} vote${b===1?'':'s'}`;
  window.RageDebug?.markCounts?.(slot, r, b);
  d('paintSlot', {slot, key, r, b, hasImages: Boolean(pack)});
}

async function renderBracket(){
  const base = cycleStart;
  if (!base){ brows.innerHTML=''; return; }

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
      d('Bracket click → activeSlot', {activeSlot});
      await paintSlot(activeSlot);
    });
  });
}

function lockUI(){
  const left = leftFromBase(cycleStart);
  const stage = left!=null ? stageForLeft(left) : currentStage;
  currentStage = stage;

  phaseBadge.textContent = cycleStart ? `phase: ${cycleStart}${usedLocalFallback?' (local)':''}` : 'phase: —';
  btnPause.textContent = paused ? 'Resume' : 'Pause';

  // Only allow votes in the current round
  const locked = (stageOf(activeSlot) !== currentStage);
  [voteA, voteB, submitBtn].forEach(b=> b.disabled = locked || !currentUid);

  d('lockUI', {
    left, stage, activeSlot,
    locked,
    loggedIn: Boolean(currentUid)
  });
}

async function fetchState(){
  // GET server state
  let body = {};
  try{
    const res  = await fetch(EDGE_URL, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }});
    body = await res.json();
  }catch(e){
    d('EDGE GET error', e);
  }

  if (body?.baseISO && body.baseISO !== cycleStart) {
    d('EDGE baseISO update', {old:cycleStart, new:body.baseISO});
  }

  cycleStart = body.baseISO || cycleStart;
  if (typeof body?.paused === 'boolean') paused = body.paused;

  // If no base yet, try POST once; otherwise fallback to local base so the UI always runs.
  if (!cycleStart && !usedLocalFallback){
    try{
      const r = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        body: JSON.stringify({})
      });
      if (!r.ok) d('Edge POST failed', {status:r.status});
    }catch(e){ d('Edge POST error', e); }

    try{
      const again = await fetch(EDGE_URL, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }});
      const b2 = await again.json();
      cycleStart = b2.baseISO || null;
    }catch(e){}
  }

  if (!cycleStart){
    let local = localStorage.getItem('rs_local_base');
    if (!local) {
      const now = new Date(); now.setSeconds(0,0);
      local = now.toISOString();
      localStorage.setItem('rs_local_base', local);
    }
    cycleStart = local;
    usedLocalFallback = true;
  }

  // drive the visible countdown strictly from baseISO
  const left = leftFromBase(cycleStart);
  if (left != null){
    clockEl.textContent = paused ? `⏸ ${left}` : String(left);
  }

  // at each tick, if we’re exactly on a 20s boundary (except cycle start), ask server to decide
  await maybeDecide(left);
}

async function postAction(action){
  try{
    await fetch(EDGE_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:SUPABASE_ANON, Authorization:`Bearer ${SUPABASE_ANON}` },
      body: JSON.stringify({action})
    });
  }catch(e){
    d('postAction error', {action, e});
  }
  await fetchState();
}

// --- Deep vote debugger: probes before/after upsert ---
async function debugVoteProbe(key, chosen){
  try{
    const pre = await supabase
      .from(TABLE_VOTES)
      .select('user_id,vote,inserted_at')
      .eq('phase_key', key);

    d('VOTE PROBE (before upsert)', {
      key, chosen,
      total: pre.data?.length ?? 0,
      mine: (pre.data||[]).find(r=>r.user_id===currentUid) || null,
      error: pre.error || null
    });
  }catch(e){ d('VOTE PROBE pre error', e); }

  // small wait to let the DB settle after upsert when called post-upsert
  await new Promise(r=>setTimeout(r,120));

  try{
    const post = await supabase
      .from(TABLE_VOTES)
      .select('user_id,vote,inserted_at')
      .eq('phase_key', key);

    d('VOTE PROBE (after upsert)', {
      key, chosen,
      total: post.data?.length ?? 0,
      mine: (post.data||[]).find(r=>r.user_id===currentUid) || null,
      error: post.error || null
    });
  }catch(e){ d('VOTE PROBE post error', e); }
}

function wireControls(){
  $('overlayClose').onclick = ()=> overlay.classList.remove('show');
  $('btnPause').onclick = async ()=> postAction(paused ? 'resume':'pause');
  $('btnReset').onclick = async ()=>{
    lastCheckpointIndex = null;            // clear the local checkpoint tracker
    await postAction('reset');
    await paintSlot(activeSlot);
    await renderBracket();
  };

  let chosen=null;
  $('voteA').onclick=()=>{ chosen='red';  voteA.classList.add('selected'); voteB.classList.remove('selected'); submitBtn.disabled=!currentUid; };
  $('voteB').onclick=()=>{ chosen='blue'; voteB.classList.add('selected'); voteA.classList.remove('selected'); submitBtn.disabled=!currentUid; };
  $('submitBtn').onclick=async ()=>{
    if (!chosen) return;
    if (!currentUid) return alert('Log in to vote');

    const key = slotKey(activeSlot, cycleStart);
    d('VOTE click', {key, chosen, activeSlot, cycleStart, currentStage, slotStage:stageOf(activeSlot)});

    await debugVoteProbe(key, chosen); // before

    // perform upsert with explicit onConflict
    try{
      const { error } = await supabase
        .from(TABLE_VOTES)
        .upsert({ phase_key: key, user_id: currentUid, vote: chosen }, { onConflict:'phase_key,user_id' });

      if (error){
        d('VOTE upsert ERROR', {key, error});
        submitBtn.textContent='✖ Vote failed';
        submitBtn.disabled=true;
        setTimeout(()=>{ submitBtn.textContent='Submit Vote'; submitBtn.disabled=false; }, 1300);
        alert(`Vote failed: ${error.message || 'unknown error'}`);
        return;
      }

      d('VOTE upsert OK', {key, chosen});
      await debugVoteProbe(key, chosen); // after

      await paintSlot(activeSlot);
      submitBtn.textContent='✔ Voted'; submitBtn.disabled=true;
      setTimeout(()=>{ submitBtn.textContent='Submit Vote'; submitBtn.disabled=false; voteA.classList.remove('selected'); voteB.classList.remove('selected'); chosen=null; }, 1200);
    }catch(e){
      d('VOTE upsert EXCEPTION', e);
      submitBtn.textContent='✖ Vote failed';
      submitBtn.disabled=true;
      setTimeout(()=>{ submitBtn.textContent='Submit Vote'; submitBtn.disabled=false; }, 1300);
      alert(`Vote failed (exception). See console for details.`);
    }
  };
}

function wireRealtime(){
  supabase.channel('v2-votes')
    .on('postgres_changes',{event:'*',schema:'public',table:TABLE_VOTES}, async (payload)=>{
      d('Realtime: votes change', payload);
      await paintSlot(activeSlot);
    }).subscribe((status)=>{ d('Realtime channel v2-votes status', status); });

  supabase.channel('v2-winners')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:TABLE_WINNERS}, (payload)=>{
      d('Realtime: winners INSERT', payload);
      const pk = payload?.new?.phase_key || '';
      if (pk.endsWith('::final') && pk.startsWith(cycleStart)){
        const color = (payload?.new?.color||'').toLowerCase();
        overlayNote.textContent = color === 'red' ? 'Left side triumphs.' : 'Right side triumphs.';
        overlayImg.src = color==='red' ? imgA.src : imgB.src;
        overlay.classList.add('show');
      }
    }).subscribe((status)=>{ d('Realtime channel v2-winners status', status); });
}

async function boot(){
  // auth
  const { data:{session} } = await supabase.auth.getSession();
  currentUid = session?.user?.id || null;
  loginBadge.textContent = currentUid ? 'logged in' : 'not logged in';
  supabase.auth.onAuthStateChange((_evt, session2)=>{
    currentUid = session2?.user?.id || null;
    loginBadge.textContent = currentUid ? 'logged in' : 'not logged in';
    d('Auth state change', {loggedIn:Boolean(currentUid)});
    lockUI();
  });

  // first state load + initial paints
  await fetchState();
  lockUI();
  await loadAdvancers(cycleStart);
  await paintSlot(activeSlot);
  await renderBracket();

  // heartbeat (1s): recompute left from baseISO so the clock starts at 100 and ticks down
  (async function tick(){
    try{
      await fetchState();     // updates countdown + may trigger decide at boundaries
      lockUI();               // updates stage gates from left
      await loadAdvancers(cycleStart);
      await paintSlot(activeSlot);
      await renderBracket();
    }catch(e){ d('tick error', e); }
    setTimeout(tick, 1000);
  })();

  wireControls();
  wireRealtime();
}

// expose for debugger
window.__matchup__ = { paintSlot, fetchState, advancers };

// start app when DOM is ready
function startWhenReady(){
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
startWhenReady();