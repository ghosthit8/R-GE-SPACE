// matchup.app.js
import { SUPABASE_URL, SUPABASE_ANON, EDGE_URL } from './matchup.config.js';

// Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// STATE
let currentUid = null;
let cycleStart = null;
let periodSec = 100;
let lastCheckpoint = 0; // 0..5
let paused = false;

let activeSlot = 'r32_1';
let currentStage = 'r32';

// DOM
const $ = (id) => document.getElementById(id);
const imgA = $('imgA');
const imgB = $('imgB');
const clockEl = $('clock');
const phaseBadge = $('phaseBadge');
const loginStatus = $('loginStatus');
const voteA = $('voteA');
const voteB = $('voteB');
const submitBtn = $('submitBtn');

let chosen = null;

// simple map of which color advanced for a given phase_key
let advancers = new Map();

// ---------------------------------------------------------------
// SEED / PACK HELPERS (placeholder images unless you’ve wired uploads)
// ---------------------------------------------------------------
const stageOf = (slot)=>
  slot.startsWith('r32')?'r32':
  slot.startsWith('r16')?'r16':
  slot.startsWith('qf') ?'qf' :
  (slot.startsWith('sf')?'sf':'final');

const stageLevel = (s)=> s==='r32'?1:s==='r16'?2:s==='qf'?3:s==='sf'?4:5;
const slotLevel  = (slot)=> stageLevel(stageOf(slot));
function baseForSlot(){ return cycleStart; }
function slotKey(slot, base){ return slot==='final' ? `${base}::final` : `${base}::${slot}`; }

function seedUrlFromKey(baseISO, suffix){
  const s = encodeURIComponent(`${baseISO}-${suffix}`);
  return `https://picsum.photos/seed/${s}/1600/1200`;
}
function r32Pack(baseISO, n){
  return { A: seedUrlFromKey(baseISO, `A${n}`), B: seedUrlFromKey(baseISO, `B${n}`) };
}

const slotsR32 = Array.from({length:16}, (_,i)=>`r32_${i+1}`);
const slotsR16 = Array.from({length:8},  (_,i)=>`r16_${i+1}`);
const slotsQF  = ['qf1','qf2','qf3','qf4'];
const slotsSF  = ['sf1','sf2'];

// ---------------------------------------------------------------
// Load “advancers” so later packs can render winners from prior round
// ---------------------------------------------------------------
async function loadAdvancers(baseISO){
  if (!baseISO){ advancers = new Map(); return; }
  const url =
    `${SUPABASE_URL}/rest/v1/advancers_v2`
    + `?select=phase_key,color,from_key&base=eq.${encodeURIComponent(baseISO)}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  });
  if (!res.ok) { advancers = new Map(); return; }
  const rows = await res.json();
  advancers = new Map(rows.map(r => [r.phase_key, { color: r.color, from: r.from_key }]));
}

// ---------------------------------------------------------------
// Packs per slot (placeholder logic; uses advancers to chain results)
// ---------------------------------------------------------------
async function packFor(slot){
  const base = baseForSlot();
  if (!base) return null;

  if (slot.startsWith('r32_')){
    const n = Number(slot.split('_')[1]);
    return r32Pack(base, n);
  }

  // for later rounds, pick from advancers map
  const key = slotKey(slot, base);
  const adv = advancers.get(key);
  if (!adv || !adv.from) return null;

  // for simplicity: if came from r32_X, reuse that seed; otherwise fallback
  const from = adv.from.split('::')[1] || '';
  const m = from.match(/r32_(\d+)/);
  if (m){
    const n = Number(m[1]);
    const pack = r32Pack(base, n);
    return adv.color === 'red' ? { A: pack.A, B: pack.B } : { A: pack.B, B: pack.A };
  }
  // unknown upstream: harmless placeholder
  return { A: seedUrlFromKey(base, `${slot}-A`), B: seedUrlFromKey(base, `${slot}-B`) };
}

// ---------------------------------------------------------------
// TIMER / STATE (FIXED to match Edge response)
// ---------------------------------------------------------------
async function fetchState(){
  const res = await fetch(EDGE_URL, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` }
  });
  const body = await res.json();

  // Map Edge GET → UI fields
  cycleStart = body.baseISO || null;
  periodSec  = Number(body.decision_seconds ?? periodSec ?? 30);
  // Edge 'clock' is the current second within the decision window
  clockEl.textContent = String(Math.floor(body.clock ?? 0));

  // If the Edge ever includes a checkpoint again, derive a stage from it
  if (typeof body.last_checkpoint === 'number') {
    lastCheckpoint = body.last_checkpoint;
    currentStage = ['r32','r16','qf','sf','final'][Math.max(0, lastCheckpoint)-1] || currentStage || 'r32';
  }
}

function lockUI(){
  phaseBadge.textContent = cycleStart ? `phase: ${cycleStart}` : 'phase: —';
  loginStatus.textContent = currentUid ? 'logged in' : 'not logged in';
  submitBtn.disabled = !currentUid || !chosen;
}

async function setAuth(){
  const { data: { user } } = await supabase.auth.getUser();
  currentUid = user?.id || null;
  loginStatus.textContent = currentUid ? 'logged in' : 'not logged in';
}

// ---------------------------------------------------------------
// Painting & votes
// ---------------------------------------------------------------
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
}

// ---------------------------------------------------------------
// Bracket render (thumbnail grid; safe if packs are null)
// ---------------------------------------------------------------
async function renderBracket(){
  const base = baseForSlot();
  if (!base) return;
  const all = [...slotsR32, ...slotsR16, ...slotsQF, ...slotsSF, 'final'];
  for (const s of all){
    const pack = await packFor(s);
    const elA = document.querySelector(`[data-thumb="${s}-A"]`);
    const elB = document.querySelector(`[data-thumb="${s}-B"]`);
    if (elA && elB){
      if (pack){ elA.src = pack.A; elB.src = pack.B; }
      else { elA.removeAttribute('src'); elB.removeAttribute('src'); }
    }
  }
}

// ---------------------------------------------------------------
// Controls & realtime
// ---------------------------------------------------------------
function wireControls(){
  voteA.onclick = ()=>{ chosen='red'; voteA.classList.add('selected'); voteB.classList.remove('selected'); submitBtn.disabled=!currentUid; };
  voteB.onclick = ()=>{ chosen='blue'; voteB.classList.add('selected'); voteA.classList.remove('selected'); submitBtn.disabled=!currentUid; };
  submitBtn.onclick = async ()=>{
    if (!chosen) return;
    if (!currentUid) return alert('Log in to vote');
    const key = slotKey(activeSlot, baseForSlot());
    await supabase.from('phase_votes_v2')
      .upsert({ phase_key: key, user_id: currentUid, vote: chosen }, { onConflict:'phase_key,user_id' });
    await paintSlot(activeSlot);
    submitBtn.textContent='✔ Voted'; submitBtn.disabled=true;
  };
}

function wireRealtime(){
  supabase.channel('v2-votes')
    .on('postgres_changes',{event:'*',schema:'public',table:'phase_votes_v2'}, async ()=>{
      await paintSlot(activeSlot);
    }).subscribe();
}

// ---------------------------------------------------------------
// BOOT (FIXED: bootstrap cycle if Edge has no active base)
// ---------------------------------------------------------------
async function boot(){
  await setAuth();
  supabase.auth.onAuthStateChange((_evt, session)=>{
    currentUid = session?.user?.id || null;
    loginStatus.textContent = currentUid ? 'logged in' : 'not logged in';
    lockUI();
  });

  await fetchState();

  // ★ If no active base, ask the Edge to start/advance once, then re-fetch
  if (!cycleStart) {
    await fetch(EDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`
      },
      body: JSON.stringify({})
    });
    await fetchState();
  }
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
      // keep advancers fresh (cheap GET)
      await loadAdvancers(cycleStart);
    }catch{}
    setTimeout(tick, 1000);
  })();

  wireControls();
  wireRealtime();
}

// expose for debugger helpers
window.__matchup__ = { paintSlot, fetchState, advancers };

boot();