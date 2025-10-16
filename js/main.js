// js/main.js
// App orchestrator: state sync loop, painting, voting, realtime, and UI init.

import {
  // DOM
  clockEl, pauseBtn, voteA, voteB, submitBtn,
  countA, countB, labelA, labelB,
  // shared state (read)
  paused, serverPhaseEndISO, periodSec,
  // live vars (we'll update via setters)
  currentPhaseKey, prevPhaseKey, remainingSec, lastSyncAt, lastCountsAt,
  currentUid, chosen, activeSlot, currentStage, overlayGateBase,
  imgCache, lastPaintedBattleKey,
  // helpers
  setBoot, startBootTick, endBoot, iso, toast,
  getUidOrNull, paintLoginBadge, callEdge,
  normalize, seedUrlFromKey, baseForSlot,
  setStateUI, slotFinished, votingLockedFor, applyVotingLockUI,
  // setters
  setPaused, setPeriodSec, setServerPhaseEndISO,
  setCurrentPhaseKey, setPrevPhaseKey, setRemainingSec,
  setLastSyncAt, setLastCountsAt, setCurrentUid, setChosen,
} from "./core.js";

import {
  fetchTimerState, detectStage,
  countVotesFor, upsertVote, decideAndPersistWinner,
  getR16EntrantSourcesFromR32Winners,
  getQFEntrantSourcesFromR16Winners,
  getSemiEntrantSourcesFromQFWinners,
  getFinalEntrantSourcesFromWinners,
  r32KeysFor, qfKeysFor, semiKeysFor, finalKeyFor,
} from "./services.js";

import { initFullscreenControls, setCurrentMatchImages } from "./ui.js";
import { renderBracket, highlightActiveRow } from "./features/bracket.js";
import { initOverlay, showChampion } from "./features/overlay.js";

/* ---------------- Small local helpers ---------------- */

function fmtVotes(n){ return `${n} ${n===1?'vote':'votes'}`; }

function currentBattleKey(){
  const base = baseForSlot(activeSlot);
  if (!base) return null;
  return activeSlot === "final" ? finalKeyFor(base) : `${base}::${activeSlot}`;
}

/* Paint labels (accessible, visually hidden by CSS) */
function paintLabelsFor(slot){
  if (slot.startsWith("r32")){
    const n = slot.split("_")[1];
    labelA.textContent = `R32 ${n} — Left`;
    labelB.textContent = `R32 ${n} — Right`;
  } else if (slot.startsWith("r16")){
    const n = slot.split("_")[1];
    labelA.textContent = `R16 ${n} — Left`;
    labelB.textContent = `R16 ${n} — Right`;
  } else if (slot.startsWith("qf")){
    const n = slot.slice(2);
    labelA.textContent = `QF ${n} — Left`;
    labelB.textContent = `QF ${n} — Right`;
  } else if (slot === "sf1" || slot === "sf2"){
    const n = slot.slice(2);
    labelA.textContent = `SF ${n} — Left`;
    labelB.textContent = `SF ${n} — Right`;
  } else {
    labelA.textContent = "Final — Left";
    labelB.textContent = "Final — Right";
  }
}

/* ---------------- Current match painter ---------------- */

async function paintImagesForActive(){
  const slot = activeSlot;
  const base = baseForSlot(slot);
  if (!base) return;

  const battleKey = (slot === "final") ? finalKeyFor(base) : `${base}::${slot}`;

  if (imgCache.has(battleKey)) {
    setCurrentMatchImages(imgCache.get(battleKey));
  } else {
    if (slot.startsWith("r32")){
      const idx = Number(slot.split("_")[1]); // 1..16
      const pack = { A: seedUrlFromKey(base, `A${idx}`), B: seedUrlFromKey(base, `B${idx}`) };
      imgCache.set(battleKey, pack);
      setCurrentMatchImages(pack);
    } else if (slot.startsWith("r16")){
      const pack = await getR16EntrantSourcesFromR32Winners(slot);
      if (pack){ imgCache.set(battleKey, pack); setCurrentMatchImages(pack); }
      else { setCurrentMatchImages({A:"",B:""}); }
    } else if (slot.startsWith("qf")){
      const pack = await getQFEntrantSourcesFromR16Winners(slot);
      if (pack){ imgCache.set(battleKey, pack); setCurrentMatchImages(pack); }
      else { setCurrentMatchImages({A:"",B:""}); }
    } else if (slot === "sf1" || slot === "sf2"){
      const pack = await getSemiEntrantSourcesFromQFWinners(slot);
      if (pack){ imgCache.set(battleKey, pack); setCurrentMatchImages(pack); }
      else { setCurrentMatchImages({A:"",B:""}); }
    } else {
      const finals = await getFinalEntrantSourcesFromWinners();
      if (finals){ imgCache.set(battleKey, finals); setCurrentMatchImages(finals); }
      else { setCurrentMatchImages({A:"",B:""}); }
    }
  }

  paintLabelsFor(slot);
  lastPaintedBattleKey = battleKey;

  await renderBracket({
    activeSlot,
    isSlotFinished: (s)=> slotFinished(s),
    isSlotLive:     (s)=> (s && s !== "final" ? true : true) && !slotFinished(s),
  });

  applyVotingLockUI();
}

/* ---------------- Vote counts ---------------- */

async function refreshVoteCounts(){
  try{
    const key = currentBattleKey();
    if (!key){ countA.textContent = "0 votes"; countB.textContent = "0 votes"; return; }
    const { r, b } = await countVotesFor(key);
    countA.textContent = fmtVotes(r);
    countB.textContent = fmtVotes(b);
    setLastCountsAt(Date.now());
  }catch{/* ignore */}
}

/* ---------------- Phase/state sync ---------------- */

async function fetchState(){
  const prevEnd = serverPhaseEndISO;
  const prevStageSnapshot = currentStage;

  // Pull from edge
  const s = await fetchTimerState(); // normalized via services
  setServerPhaseEndISO(s.phase_end_at);
  setPaused(!!s.paused);
  setRemainingSec(s.remaining_sec);
  setPeriodSec(s.period_sec ?? 20);
  setLastSyncAt(Date.now());

  // Compute current/prev base keys
  const curKey = serverPhaseEndISO ? iso(serverPhaseEndISO) : null;
  const prevKey = curKey && periodSec ? iso(Date.parse(curKey) - periodSec * 1000) : null;
  setCurrentPhaseKey(curKey);
  setPrevPhaseKey(prevKey);
  setStateUI();

  // Handle phase flip transitions
  if (prevEnd && serverPhaseEndISO && prevEnd !== serverPhaseEndISO){
    const justEndedBase = iso(prevEnd);

    if (prevStageSnapshot === "final"){
      const fKey = finalKeyFor(justEndedBase);
      const color = await decideAndPersistWinner(fKey);
      if (!imgCache.has(fKey)){
        const pack = await getFinalEntrantSourcesFromWinners();
        if (pack) imgCache.set(fKey, pack);
      }
      if (overlayGateBase === justEndedBase) showChampion(color, justEndedBase);
      overlayGateBase = null;
      activeSlot = "r32_1";
      imgCache.clear(); lastPaintedBattleKey = null;

    } else if (prevStageSnapshot === "sf"){
      const { sf1, sf2 } = semiKeysFor(justEndedBase);
      await Promise.all([ decideAndPersistWinner(sf1), decideAndPersistWinner(sf2) ]);
      overlayGateBase = currentPhaseKey;
      activeSlot = "final";
      const pack = await getFinalEntrantSourcesFromWinners();
      if (pack) imgCache.set(finalKeyFor(currentPhaseKey), pack);
      lastPaintedBattleKey = null;

    } else if (prevStageSnapshot === "qf"){
      const { qf1, qf2, qf3, qf4 } = qfKeysFor(justEndedBase);
      await Promise.all([
        decideAndPersistWinner(qf1),
        decideAndPersistWinner(qf2),
        decideAndPersistWinner(qf3),
        decideAndPersistWinner(qf4),
      ]);
      activeSlot = "sf1";
      const p1 = await getSemiEntrantSourcesFromQFWinners("sf1");
      const p2 = await getSemiEntrantSourcesFromQFWinners("sf2");
      if (p1) imgCache.set(`${currentPhaseKey}::sf1`, p1);
      if (p2) imgCache.set(`${currentPhaseKey}::sf2`, p2);
      lastPaintedBattleKey = null;

    } else if (prevStageSnapshot === "r16"){
      const r16 = Array.from({length:8},(_,i)=>`${justEndedBase}::r16_${i+1}`);
      await Promise.all(r16.map(k=>decideAndPersistWinner(k)));
      activeSlot = "qf1";
      const qp1 = await getQFEntrantSourcesFromR16Winners("qf1");
      const qp2 = await getQFEntrantSourcesFromR16Winners("qf2");
      const qp3 = await getQFEntrantSourcesFromR16Winners("qf3");
      const qp4 = await getQFEntrantSourcesFromR16Winners("qf4");
      if (qp1) imgCache.set(`${currentPhaseKey}::qf1`, qp1);
      if (qp2) imgCache.set(`${currentPhaseKey}::qf2`, qp2);
      if (qp3) imgCache.set(`${currentPhaseKey}::qf3`, qp3);
      if (qp4) imgCache.set(`${currentPhaseKey}::qf4`, qp4);
      lastPaintedBattleKey = null;

    } else {
      const r32 = r32KeysFor(justEndedBase);
      await Promise.all(Object.values(r32).map(k=>decideAndPersistWinner(k)));
      activeSlot = "r16_1";
      for (let i=1;i<=8;i++){
        const slot = `r16_${i}`;
        const pack = await getR16EntrantSourcesFromR32Winners(slot);
        if (pack) imgCache.set(`${currentPhaseKey}::${slot}`, pack);
      }
      lastPaintedBattleKey = null;
    }
  }

  // Detect stage for the *current* base
  const { stage } = await detectStage();
  currentStage = stage;

  await paintImagesForActive();
  await refreshVoteCounts();
  await renderBracket({
    activeSlot,
    isSlotFinished: (s)=> slotFinished(s),
    isSlotLive:     (s)=> (s && s !== "final" ? true : true) && !slotFinished(s),
  });
  applyVotingLockUI();
}

/* ---------------- Main loop ---------------- */

let rafId = null;
function stop(){ if (rafId) cancelAnimationFrame(rafId); rafId = null; }

async function start(){
  stop();
  const loop = async ()=>{
    if (paused){
      const remCalc = currentPhaseKey ? Math.max(0, Date.parse(serverPhaseEndISO) - Date.now()) : 0;
      const sec = (typeof remainingSec === "number" && !Number.isNaN(remainingSec))
        ? Number(remainingSec)
        : Math.ceil(remCalc / 1000);
      clockEl.textContent = String(Math.max(0, Math.ceil(sec)));
      if (Date.now() - lastSyncAt > 5000) { try{ await fetchState(); }catch{} }
    } else {
      const rem = serverPhaseEndISO ? Math.max(0, Date.parse(serverPhaseEndISO) - Date.now()) : 0;
      clockEl.textContent = String(Math.ceil(rem/1000));
      if (rem <= 0 || Date.now() - lastSyncAt > 5000) { try{ await fetchState(); }catch{} }
      if (Date.now() - lastCountsAt > 2000) refreshVoteCounts();
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

/* ---------------- Realtime ---------------- */

function initRealtime(){
  // Winners + votes realtime
  import("./core.js").then(({ supabase }) => {
    supabase
      .channel("winners-final-overlay")
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"winners" }, (payload)=>{
        const key = payload?.new?.phase_key || "";
        const color = (payload?.new?.color || "").toLowerCase();
        if (!key.endsWith("::final")) return;
        const base = key.split("::")[0];
        if (!overlayGateBase || base !== overlayGateBase) return;
        if (!(color === "red" || color === "blue")) return;

        const fKey = finalKeyFor(base);
        const ensurePack = imgCache.has(fKey)
          ? Promise.resolve()
          : getFinalEntrantSourcesFromWinners().then(pack => { if (pack) imgCache.set(fKey, pack); });

        ensurePack.then(()=> showChampion(color, base));
      })
      .subscribe();

    supabase
      .channel("phase-votes-live")
      .on("postgres_changes", { event:"*", schema:"public", table:"phase_votes" }, async (payload)=>{
        const pk = payload?.new?.phase_key || payload?.old?.phase_key;
        if (!pk) return;
        const want = currentBattleKey();
        if (pk && want && pk === want) await refreshVoteCounts();
      })
      .subscribe();
  });
}

/* ---------------- Controls / Voting ---------------- */

function initControls(){
  pauseBtn.onclick = async ()=>{
    try{
      if (paused) await callEdge("POST", { action:"resume" });
      else        await callEdge("POST", { action:"pause" });
      await fetchState();
      toast("OK");
    }catch{ toast("Pause/resume failed"); }
  };

  function clearSelection(){
    voteA.classList.remove("selected");
    voteB.classList.remove("selected");
    setChosen(null);
    submitBtn.textContent = "✅ Submit Vote";
    submitBtn.disabled = !currentUid;
  }

  voteA.onclick = ()=>{
    if (votingLockedFor(activeSlot)) return toast(slotFinished(activeSlot) ? "Voting closed" : "Not started");
    setChosen("red");
    voteA.classList.add("selected");
    voteB.classList.remove("selected");
    submitBtn.disabled = !currentUid;
  };
  voteB.onclick = ()=>{
    if (votingLockedFor(activeSlot)) return toast(slotFinished(activeSlot) ? "Voting closed" : "Not started");
    setChosen("blue");
    voteA.classList.remove("selected");
    voteB.classList.add("selected");
    submitBtn.disabled = !currentUid;
  };

  submitBtn.onclick = async ()=>{
    if (votingLockedFor(activeSlot)) return toast(slotFinished(activeSlot) ? "Voting closed" : "Not started");
    const key = currentBattleKey();
    if (!chosen || !key) return;
    if (!currentUid){ toast("Log in to vote"); return; }
    try{
      await upsertVote({ phase_key:key, vote:chosen, user_id: currentUid });
      toast("✔ Vote submitted");
      submitBtn.textContent = "✔ Voted";
      submitBtn.disabled = true;
      refreshVoteCounts();
    }catch{ toast("Vote failed"); }
  };

  window.addEventListener("rs:switch-slot", async (ev)=>{
    const { slot } = ev.detail || {};
    if (!slot) return;
    activeSlot = slot;
    clearSelection();
    lastPaintedBattleKey = null;
    await paintImagesForActive();
    await refreshVoteCounts();
    highlightActiveRow(activeSlot);
    applyVotingLockUI();
  });
}

/* ---------------- Boot / Startup ---------------- */

(async function boot(){
  startBootTick(); setBoot(5, "wiring auth");

  setCurrentUid(await getUidOrNull());
  paintLoginBadge();
  import("./core.js").then(({ supabase })=>{
    supabase.auth.onAuthStateChange((_evt, session)=>{
      setCurrentUid(session?.user?.id ?? null);
      paintLoginBadge();
      submitBtn.disabled = !chosen || !currentUid;
    });
  });

  setBoot(35, "fetching state");
  try {
    await fetchState();
  } catch (e) {
    console.error("[boot] fetchState failed:", e);
    toast("Couldn’t reach timer. Loading offline mode.");
    setPaused(true);
    setRemainingSec(null);
    // continue boot so UI loads
  }

  setBoot(58, "seeding images");
  await paintImagesForActive();

  setBoot(74, "loading vote counts");
  await refreshVoteCounts();

  setBoot(86, "initializing UI");
  initFullscreenControls();
  initOverlay();
  initControls();
  initRealtime();

  setBoot(92, "starting engine");
  await start();

  setBoot(100, "ready");
  endBoot();
})();