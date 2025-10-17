// js/main.js — uses fixed R32 images for the live match; other rounds unchanged

import {
  // DOM
  clockEl, pauseBtn, voteA, voteB, submitBtn,
  countA, countB, labelA, labelB,
  // state (read)
  paused, serverPhaseEndISO, periodSec,
  currentPhaseKey, prevPhaseKey, remainingSec, lastSyncAt, lastCountsAt,
  currentUid, chosen, activeSlot, currentStage, overlayGateBase,
  imgCache, lastPaintedBattleKey,
  // helpers
  setBoot, startBootTick, endBoot, iso, toast,
  getUidOrNull, toggleTimer,
  seedUrlFromKey, baseForSlot, setStateUI,
  slotFinished, votingLockedFor, applyVotingLockUI,
  // setters
  setPaused, setPeriodSec, setServerPhaseEndISO,
  setCurrentPhaseKey, setPrevPhaseKey, setRemainingSec,
  setLastSyncAt, setLastCountsAt, setCurrentUid, setChosen,
  setActiveSlot, setCurrentStage, setOverlayGateBase, setLastPaintedBattleKey,
  fixedSeedPair,
} from "./core.js?v=27";

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

/* helpers */
function fmtVotes(n){ return `${n} ${n===1?'vote':'votes'}`; }
function currentBattleKey(){
  const base = baseForSlot(activeSlot);
  if (!base) return null;
  return activeSlot === "final" ? finalKeyFor(base) : `${base}::${activeSlot}`;
}

/* labels */
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

/* paint current match */
async function paintImagesForActive(){
  const slot = activeSlot;
  const base = baseForSlot(slot) || new Date().toISOString();
  if (!base) return;

  const battleKey = (slot === "final") ? finalKeyFor(base) : `${base}::${slot}`;

  if (imgCache.has(battleKey)) {
    setCurrentMatchImages(imgCache.get(battleKey));
  } else {
    if (slot.startsWith("r32")){
      // ← fixed images for R32, no randomness or network dependency
      const pack = fixedSeedPair(slot);
      imgCache.set(battleKey, pack);
      setCurrentMatchImages(pack);
    } else if (slot.startsWith("r16")){
      const pack = await getR16EntrantSourcesFromR32Winners(slot);
      setCurrentMatchImages(pack || {A:"",B:""});
      if (pack) imgCache.set(battleKey, pack);
    } else if (slot.startsWith("qf")){
      const pack = await getQFEntrantSourcesFromR16Winners(slot);
      setCurrentMatchImages(pack || {A:"",B:""});
      if (pack) imgCache.set(battleKey, pack);
    } else if (slot === "sf1" || slot === "sf2"){
      const pack = await getSemiEntrantSourcesFromQFWinners(slot);
      setCurrentMatchImages(pack || {A:"",B:""});
      if (pack) imgCache.set(battleKey, pack);
    } else {
      const finals = await getFinalEntrantSourcesFromWinners();
      setCurrentMatchImages(finals || {A:"",B:""});
      if (finals) imgCache.set(battleKey, finals);
    }
  }

  paintLabelsFor(slot);
  setLastPaintedBattleKey(battleKey);

  await renderBracket({
    activeSlot,
    isSlotFinished: (s)=> slotFinished(s),
    isSlotLive:     (s)=> (s && s !== "final" ? true : true) && !slotFinished(s),
  });

  applyVotingLockUI();
}

/* vote counts */
async function refreshVoteCounts(){
  try{
    const key = currentBattleKey();
    if (!key){ countA.textContent = "0 votes"; countB.textContent = "0 votes"; return; }
    const { r, b } = await countVotesFor(key);
    countA.textContent = fmtVotes(r);
    countB.textContent = fmtVotes(b);
    setLastCountsAt(Date.now());
  }catch{}
}

/* fetch state from Edge */
async function fetchState(){
  const prevEnd = serverPhaseEndISO;
  const prevStageSnapshot = currentStage;

  const s = await fetchTimerState();
  setServerPhaseEndISO(s.phase_end_at);
  setPaused(!!s.paused);
  setRemainingSec(s.remaining_sec);
  setPeriodSec(s.period_sec ?? 20);
  setLastSyncAt(Date.now());

  const curKey = serverPhaseEndISO ? iso(serverPhaseEndISO) : null;
  const prevKey = curKey && periodSec ? iso(Date.parse(curKey) - periodSec * 1000) : null;
  setCurrentPhaseKey(curKey);
  setPrevPhaseKey(prevKey);
  setStateUI();

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
      setOverlayGateBase(null);
      setActiveSlot("r32_1");
      imgCache.clear(); setLastPaintedBattleKey(null);

    } else if (prevStageSnapshot === "sf"){
      const { sf1, sf2 } = semiKeysFor(justEndedBase);
      await Promise.all([ decideAndPersistWinner(sf1), decideAndPersistWinner(sf2) ]);
      setOverlayGateBase(currentPhaseKey);
      setActiveSlot("final");
      const pack = await getFinalEntrantSourcesFromWinners();
      if (pack) imgCache.set(finalKeyFor(currentPhaseKey), pack);
      setLastPaintedBattleKey(null);

    } else if (prevStageSnapshot === "qf"){
      const { qf1, qf2, qf3, qf4 } = qfKeysFor(justEndedBase);
      await Promise.all([
        decideAndPersistWinner(qf1),
        decideAndPersistWinner(qf2),
        decideAndPersistWinner(qf3),
        decideAndPersistWinner(qf4),
      ]);
      setActiveSlot("sf1");
      const p1 = await getSemiEntrantSourcesFromQFWinners("sf1");
      const p2 = await getSemiEntrantSourcesFromQFWinners("sf2");
      if (p1) imgCache.set(`${currentPhaseKey}::sf1`, p1);
      if (p2) imgCache.set(`${currentPhaseKey}::sf2`, p2);
      setLastPaintedBattleKey(null);

    } else if (prevStageSnapshot === "r16"){
      const r16 = Array.from({length:8},(_,i)=>`${justEndedBase}::r16_${i+1}`);
      await Promise.all(r16.map(k=>decideAndPersistWinner(k)));
      setActiveSlot("qf1");
      const qp1 = await getQFEntrantSourcesFromR16Winners("qf1");
      const qp2 = await getQFEntrantSourcesFromR16Winners("qf2");
      const qp3 = await getQFEntrantSourcesFromR16Winners("qf3");
      const qp4 = await getQFEntrantSourcesFromR16Winners("qf4");
      if (qp1) imgCache.set(`${currentPhaseKey}::qf1`, qp1);
      if (qp2) imgCache.set(`${currentPhaseKey}::qf2`, qp2);
      if (qp3) imgCache.set(`${currentPhaseKey}::qf3`, qp3);
      if (qp4) imgCache.set(`${currentPhaseKey}::qf4`, qp4);
      setLastPaintedBattleKey(null);

    } else {
      const r32 = r32KeysFor(justEndedBase);
      await Promise.all(Object.values(r32).map(k=>decideAndPersistWinner(k)));
      setActiveSlot("r16_1");
      for (let i=1;i<=8;i++){
        const slot = `r16_${i}`;
        const pack = await getR16EntrantSourcesFromR32Winners(slot);
        if (pack) imgCache.set(`${currentPhaseKey}::${slot}`, pack);
      }
      setLastPaintedBattleKey(null);
    }
  }

  const { stage } = await detectStage();
  setCurrentStage(stage);

  await paintImagesForActive();
  await refreshVoteCounts();
  await renderBracket({
    activeSlot,
    isSlotFinished: (s)=> slotFinished(s),
    isSlotLive:     (s)=> (s && s !== "final" ? true : true) && !slotFinished(s),
  });
  applyVotingLockUI();
}

/* main loop */
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

/* realtime */
function initRealtime(){
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

/* controls */
function initControls(){
  pauseBtn.onclick = async ()=>{
    try{
      await toggleTimer(paused ? "resume" : "pause");
      await fetchState();
      toast("OK");
    }catch(e){ toast("Pause/resume failed"); }
  };

  function clearSelection(){
    voteA.classList.remove("selected"); voteB.classList.remove("selected");
    setChosen(null); submitBtn.textContent = "✅ Submit Vote"; submitBtn.disabled = !currentUid;
  }

  voteA.onclick = ()=>{
    if (votingLockedFor(activeSlot)) return toast(slotFinished(activeSlot) ? "Voting closed" : "Not started");
    setChosen("red"); voteA.classList.add("selected"); voteB.classList.remove("selected"); submitBtn.disabled = !currentUid;
  };
  voteB.onclick = ()=>{
    if (votingLockedFor(activeSlot)) return toast(slotFinished(activeSlot) ? "Voting closed" : "Not started");
    setChosen("blue"); voteA.classList.remove("selected"); voteB.classList.add("selected"); submitBtn.disabled = !currentUid;
  };

  submitBtn.onclick = async ()=>{
    if (votingLockedFor(activeSlot)) return toast(slotFinished(activeSlot) ? "Voting closed" : "Not started");
    const key = currentBattleKey(); if (!chosen || !key) return;
    if (!currentUid){ toast("Log in to vote"); return; }
    try{
      await upsertVote({ phase_key:key, vote:chosen, user_id: currentUid });
      toast("✔ Vote submitted"); submitBtn.textContent = "✔ Voted"; submitBtn.disabled = true; refreshVoteCounts();
    }catch{ toast("Vote failed"); }
  };

  window.addEventListener("rs:switch-slot", async (ev)=>{
    const { slot } = ev.detail || {}; if (!slot) return;
    setActiveSlot(slot);
    clearSelection();
    setLastPaintedBattleKey(null);
    await paintImagesForActive();
    await refreshVoteCounts();
    highlightActiveRow(activeSlot);
    applyVotingLockUI();
  });
}

/* boot */
(async function boot(){
  startBootTick(); setBoot(5, "wiring auth");

  try {
    setCurrentUid(await getUidOrNull());
    import("./core.js").then(({ supabase })=>{
      supabase.auth.onAuthStateChange((_evt, session)=>{
        setCurrentUid(session?.user?.id ?? null);
        submitBtn.disabled = !chosen || !currentUid;
      });
    });

    setBoot(35, "fetching state");
    try { await fetchState(); }
    catch {
      toast("Couldn’t reach timer. Offline mode.");
      setPaused(true); setRemainingSec(null);
      if (!currentPhaseKey) {
        const now = Date.now();
        setCurrentPhaseKey(new Date(now).toISOString());
        setPrevPhaseKey(new Date(now - (periodSec || 20) * 1000).toISOString());
      }
    }

    setBoot(58, "seeding images");
    try { await paintImagesForActive(); } catch {}

    setBoot(74, "loading vote counts");
    try { await refreshVoteCounts(); } catch {}

    setBoot(86, "initializing UI");
    initFullscreenControls(); initOverlay(); initControls(); try { initRealtime(); } catch {}

    setBoot(92, "starting engine"); await start();
    setBoot(100, "ready");
  } finally {
    endBoot();
  }
})();