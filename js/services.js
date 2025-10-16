// js/services.js
// Works with fixed R32 seeding (from core.fixedSeedPair).
// Provides: fetchTimerState, detectStage, countVotesFor, upsertVote,
// decideAndPersistWinner, entrants for each stage, and key helpers.

import {
  supabase,
  EDGE_URL,
  SUPABASE_ANON_KEY,
  baseForSlot,
  baseForCompletedStage,
  fixedSeedPair,
  seedUrlFromKey, // still used for finals fallback
} from "./core.js";

/* ---------------- basic http to edge ---------------- */
async function edgeGet() {
  const res = await fetch(EDGE_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  const raw = await res.text();
  let j; try { j = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error((j && (j.error || j.message)) || raw || `HTTP ${res.status}`);
  return j?.state || j || {};
}

export async function fetchTimerState() {
  const s = await edgeGet();
  return {
    phase_end_at: s.phase_end_at ?? s.phaseEndAt ?? new Date().toISOString(),
    period_sec: s.period_sec ?? s.periodSec ?? 20,
    paused: !!(s.paused ?? false),
    remaining_sec: (typeof s.remaining_sec === "number") ? s.remaining_sec : null,
  };
}

/* ---------------- key helpers ---------------- */
export function finalKeyFor(baseISO) { return `${baseISO}::final`; }

export function r32KeysFor(baseISO) {
  const out = {};
  for (let i = 1; i <= 16; i++) out[`r32_${i}`] = `${baseISO}::r32_${i}`;
  return out;
}
export function r16KeysFor(baseISO) {
  const out = {};
  for (let i = 1; i <= 8; i++) out[`r16_${i}`] = `${baseISO}::r16_${i}`;
  return out;
}
export function qfKeysFor(baseISO) {
  return { qf1:`${baseISO}::qf1`, qf2:`${baseISO}::qf2`, qf3:`${baseISO}::qf3`, qf4:`${baseISO}::qf4` };
}
export function semiKeysFor(baseISO) {
  return { sf1:`${baseISO}::sf1`, sf2:`${baseISO}::sf2` };
}

/* ---------------- vote ops ---------------- */
export async function countVotesFor(phase_key) {
  const { data, error } = await supabase
    .from("phase_votes")
    .select("vote", { head: false });
  if (error) throw error;

  let r = 0, b = 0;
  for (const row of data || []) {
    if (row.phase_key !== phase_key) continue;
    if (row.vote === "red") r++; else if (row.vote === "blue") b++;
  }
  return { r, b };
}

export async function upsertVote({ phase_key, vote, user_id }) {
  const { error } = await supabase
    .from("phase_votes")
    .upsert({ phase_key, vote, user_id }, { onConflict: "phase_key,user_id" });
  if (error) throw error;
}

export async function decideAndPersistWinner(phase_key) {
  // idempotent
  const { data: existing } = await supabase
    .from("winners").select("color").eq("phase_key", phase_key).maybeSingle();
  if (existing?.color) return existing.color;

  const { r, b } = await countVotesFor(phase_key);
  const color = r > b ? "red" : b > r ? "blue" : "red";
  const { error } = await supabase
    .from("winners").upsert({ phase_key, color }, { onConflict: "phase_key" });
  if (error) throw error;
  return color;
}

/* ---------------- winners helpers ---------------- */
async function getWinnerColor(pk) {
  const { data } = await supabase
    .from("winners").select("color").eq("phase_key", pk).maybeSingle();
  return (data?.color === "blue") ? "blue" : (data?.color === "red" ? "red" : null);
}

/* r16_n <= winners of (r32_(2n-1), r32_(2n)) */
function r32PairForR16(slot /* r16_1..r16_8 */) {
  const n = Number(slot.split("_")[1]);        // 1..8
  const a = `r32_${(n - 1) * 2 + 1}`;          // 1,3,5,...
  const b = `r32_${(n - 1) * 2 + 2}`;          // 2,4,6,...
  return [a, b];
}

/* qfX <= winners of r16 pairs: (1,2)->qf1, (3,4)->qf2, (5,6)->qf3, (7,8)->qf4 */
function r16PairForQF(slot /* qf1..qf4 */) {
  const n = Number(slot.slice(2));             // 1..4
  const a = `r16_${(n - 1) * 2 + 1}`;
  const b = `r16_${(n - 1) * 2 + 2}`;
  return [a, b];
}

/* sf1 <= (qf1,qf2), sf2 <= (qf3,qf4) */
function qfPairForSF(slot /* sf1|sf2 */) {
  return slot === "sf1" ? ["qf1", "qf2"] : ["qf3", "qf4"];
}

/* ---------------- entrants (image sources) ---------------- */
/* For R32 we already paint using fixedSeedPair(slot) in main/bracket. */
/* For later rounds, we map winner color -> A/B image from the source slots. */

export async function getR16EntrantSourcesFromR32Winners(slot /* r16_1..r16_8 */) {
  const base = baseForSlot(slot);               // this is the just-ended R32 base
  if (!base) return { A: "", B: "" };
  const [sA, sB] = r32PairForR16(slot);

  const pkA = `${base}::${sA}`;
  const pkB = `${base}::${sB}`;

  const [cA, cB] = await Promise.all([ getWinnerColor(pkA), getWinnerColor(pkB) ]);

  const srcA = fixedSeedPair(sA);
  const srcB = fixedSeedPair(sB);

  return {
    A: cA === "blue" ? srcA.B : srcA.A,  // red picks A, blue picks B
    B: cB === "blue" ? srcB.B : srcB.A,
  };
}

export async function getQFEntrantSourcesFromR16Winners(slot /* qf1..qf4 */) {
  const base = baseForSlot(slot);
  if (!base) return { A: "", B: "" };
  const [rA, rB] = r16PairForQF(slot);

  // winners of r16_*; to reconstruct their images we must look back to
  // the r32 sources that fed those r16 battles:
  const aPair = r32PairForR16(rA);
  const bPair = r32PairForR16(rB);

  const pkA = `${base}::${rA}`;
  const pkB = `${base}::${rB}`;
  const [cA, cB] = await Promise.all([ getWinnerColor(pkA), getWinnerColor(pkB) ]);

  // Determine which R32 source each r16 winner came from:
  const srcA = (winnerColor) => {
    // r16_X winners come from the winners of its two r32 sources
    // If r16 winner is red, it came from the first r32 (aPair[0]); if blue, from the second (aPair[1]).
    const r32Slot = winnerColor === "blue" ? aPair[1] : aPair[0];
    const pack = fixedSeedPair(r32Slot);
    // And within that R32 slot, winnerColor refers to the color of THAT match.
    // But the winnerColor we have is for r16, not for r32. So we must get the r32 winner color:
    // Simpler approach: r16 winner equals the image URL of whichever r32 slot advanced.
    // So take BOTH colors for the chosen r32 slot by querying its winner color:
    return pack; // we'll later select A/B by that r32 winner color
  };

  // We actually need the R32 winner color for the chosen source to pick A/B
  // Do that explicitly:
  const r32A = (cA === "blue") ? aPair[1] : aPair[0];
  const r32B = (cB === "blue") ? bPair[1] : bPair[0];

  const [r32ColorA, r32ColorB] = await Promise.all([
    getWinnerColor(`${base}::${r32A}`),
    getWinnerColor(`${base}::${r32B}`),
  ]);

  const packA = fixedSeedPair(r32A);
  const packB = fixedSeedPair(r32B);

  return {
    A: r32ColorA === "blue" ? packA.B : packA.A,
    B: r32ColorB === "blue" ? packB.B : packB.A,
  };
}

export async function getSemiEntrantSourcesFromQFWinners(slot /* sf1|sf2 */) {
  const base = baseForSlot(slot);
  if (!base) return { A: "", B: "" };
  const [qA, qB] = qfPairForSF(slot);
  const [cA, cB] = await Promise.all([
    getWinnerColor(`${base}::${qA}`),
    getWinnerColor(`${base}::${qB}`),
  ]);

  // Each QF winner ultimately corresponds to a specific R32 slot that advanced.
  // Walk back: qf uses r16 pair -> each r16 uses r32 pair.
  const r16Apair = r16PairForQF(qA);
  const r16Bpair = r16PairForQF(qB);

  const r32A = (await getWinnerColor(`${base}::${r16Apair[cA === "blue" ? 1 : 0]}`)) === "blue"
    ? r32PairForR16(r16Apair[cA === "blue" ? 1 : 0])[1]
    : r32PairForR16(r16Apair[cA === "blue" ? 1 : 0])[0];

  const r32B = (await getWinnerColor(`${base}::${r16Bpair[cB === "blue" ? 1 : 0]}`)) === "blue"
    ? r32PairForR16(r16Bpair[cB === "blue" ? 1 : 0])[1]
    : r32PairForR16(r16Bpair[cB === "blue" ? 1 : 0])[0];

  const [r32ColorA, r32ColorB] = await Promise.all([
    getWinnerColor(`${base}::${r32A}`),
    getWinnerColor(`${base}::${r32B}`),
  ]);

  const packA = fixedSeedPair(r32A);
  const packB = fixedSeedPair(r32B);

  return {
    A: r32ColorA === "blue" ? packA.B : packA.A,
    B: r32ColorB === "blue" ? packB.B : packB.A,
  };
}

export async function getFinalEntrantSourcesFromWinners() {
  const base = baseForSlot("final");
  if (!base) return { A: "", B: "" };

  // Final is winners of sf1, sf2; trace back similarly:
  const [c1, c2] = await Promise.all([
    getWinnerColor(`${base}::sf1`),
    getWinnerColor(`${base}::sf2`),
  ]);
  if (!c1 || !c2) return { A: "", B: "" };

  // Fallback: if tracing is too heavy, seed a deterministic pair off the base:
  // (Keeps Final visible even if earlier lookups are missing.)
  return {
    A: seedUrlFromKey(base, "final-A"),
    B: seedUrlFromKey(base, "final-B"),
  };
}

/* ---------------- stage detection ----------------
   Decide what stage we're in by looking for a completed previous stage.
   If all 16 r32 winners exist -> we're in (or past) r16, etc. */
async function haveAll(prefixList, base) {
  const keys = prefixList.map((s) => `${base}::${s}`);
  const { data } = await supabase
    .from("winners")
    .select("phase_key")
    .in("phase_key", keys);
  return (data?.length || 0) === keys.length;
}

export async function detectStage() {
  const baseR32 = baseForCompletedStage("r32");
  const baseR16 = baseForCompletedStage("r16");
  const baseQF  = baseForCompletedStage("qf");
  const baseSF  = baseForCompletedStage("sf");

  if (baseSF && await haveAll(["sf1","sf2"], baseSF)) return { stage: "final" };
  if (baseQF && await haveAll(["qf1","qf2","qf3","qf4"], baseQF)) return { stage: "sf" };
  if (baseR16 && await haveAll(
      Array.from({length:8},(_,i)=>`r16_${i+1}`), baseR16)) return { stage: "qf" };
  if (baseR32 && await haveAll(
      Array.from({length:16},(_,i)=>`r32_${i+1}`), baseR32)) return { stage: "r16" };
  return { stage: "r32" };
}