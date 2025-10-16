// js/services.js
// Data + stage services: Supabase reads/writes, edge-timer fetch,
// winners/votes helpers, and entrant rebuilders.
// Mirrors the behavior from your original matchup file. 1

import {
  supabase,
  callEdge,
  normalize,
  // live state (read-only here)
  currentPhaseKey, prevPhaseKey, periodSec,
  // helpers
  seedUrlFromKey,
  baseForCompletedStage,
  // caches
  imgCache,
} from "./core.js";

/* ---------------- Timer / Edge state ---------------- */

export async function fetchTimerState() {
  // Raw call to edge + normalization (no UI side-effects here)
  const s = normalize(await callEdge("GET"));
  return {
    phase_end_at: s.phase_end_at,
    paused: s.paused,
    period_sec: s.period_sec,
    remaining_sec: s.remaining_sec,
  };
}

/* ---------------- Winners / Votes I/O ---------------- */

export async function countVotesFor(phaseKey) {
  const { data, error } = await supabase
    .from("phase_votes")
    .select("vote")
    .eq("phase_key", phaseKey);

  if (error) throw error;
  let r = 0, b = 0;
  (data || []).forEach(({ vote }) => {
    if (vote === "red") r++;
    else if (vote === "blue") b++;
  });
  return { r, b };
}

export async function upsertVote({ phase_key, vote, user_id }) {
  const { error } = await supabase.from("phase_votes").upsert(
    { phase_key, vote, user_id },
    { onConflict: "phase_key,user_id" }
  );
  if (error) throw error;
  return true;
}

export async function decideAndPersistWinner(phaseKeyISO) {
  // Tally
  const { r, b } = await countVotesFor(phaseKeyISO);
  const color =
    r === b ? (Math.random() < 0.5 ? "red" : "blue") : r > b ? "red" : "blue";

  // Insert or read existing
  const { error: insErr } = await supabase
    .from("winners")
    .insert({ phase_key: phaseKeyISO, color })
    .select()
    .single();

  if (insErr) {
    const { data } = await supabase
      .from("winners")
      .select("color")
      .eq("phase_key", phaseKeyISO)
      .limit(1);
    const c = (data?.[0]?.color || "").toLowerCase();
    if (c === "red" || c === "blue") return c;
  }
  return color;
}

/* ---------------- Stage / Keys helpers ---------------- */

export function r32KeysFor(baseISO) {
  const o = {};
  for (let i = 1; i <= 16; i++) o[`r32_${i}`] = `${baseISO}::r32_${i}`;
  return o;
}
export function r16KeysFor(baseISO) {
  const o = {};
  for (let i = 1; i <= 8; i++) o[`r16_${i}`] = `${baseISO}::r16_${i}`;
  return o;
}
export function qfKeysFor(baseISO) {
  return {
    qf1: `${baseISO}::qf1`,
    qf2: `${baseISO}::qf2`,
    qf3: `${baseISO}::qf3`,
    qf4: `${baseISO}::qf4`,
  };
}
export function semiKeysFor(baseISO) {
  return { sf1: `${baseISO}::sf1`, sf2: `${baseISO}::sf2` };
}
export function finalKeyFor(baseISO) {
  return `${baseISO}::final`;
}

/**
 * Detects the *current* stage based on winners that exist for the previous base.
 * Matches your original ordering and logic: FINAL > SF > QF > R16 > R32. 2
 */
export async function detectStage() {
  if (!currentPhaseKey || !prevPhaseKey) return { stage: "r32" };

  // If previous base has both SF winners → we're in FINAL
  const { data: sfW } = await supabase
    .from("winners")
    .select("phase_key")
    .in("phase_key", [`${prevPhaseKey}::sf1`, `${prevPhaseKey}::sf2`]);
  if ((sfW || []).length === 2) return { stage: "final" };

  // Else if previous base has all QF winners → we're in SF
  const { data: qfW } = await supabase
    .from("winners")
    .select("phase_key")
    .in("phase_key", [
      `${prevPhaseKey}::qf1`,
      `${prevPhaseKey}::qf2`,
      `${prevPhaseKey}::qf3`,
      `${prevPhaseKey}::qf4`,
    ]);
  if ((qfW || []).length === 4) return { stage: "sf" };

  // Else if previous base has all R16 winners → we're in QF
  const r16 = Array.from({ length: 8 }, (_, i) => `${prevPhaseKey}::r16_${i + 1}`);
  const { data: r16W } = await supabase
    .from("winners")
    .select("phase_key")
    .in("phase_key", r16);
  if ((r16W || []).length === 8) return { stage: "qf" };

  // Else if previous base has all R32 winners → we're in R16
  const r32 = Array.from({ length: 16 }, (_, i) => `${prevPhaseKey}::r32_${i + 1}`);
  const { data: r32W } = await supabase
    .from("winners")
    .select("phase_key")
    .in("phase_key", r32);
  if ((r32W || []).length === 16) return { stage: "r16" };

  // Else → still in R32
  return { stage: "r32" };
}

/* ---------------- Entrant builders (reconstruct sources) ---------------- */
/* These rebuild the correct A/B image sources for downstream rounds using
   the recorded winners’ colors. They also seed imgCache like your file.  */

/** R16 entrants from R32 winners (pairs: 1/2, 3/4, ..., 15/16) */
export async function getR16EntrantSourcesFromR32Winners(which /* r16_1..r16_8 */) {
  const r32Base = baseForCompletedStage("r32");
  if (!r32Base) return null;

  const idx = Number(which.split("_")[1]); // 1..8
  const pair = [idx * 2 - 1, idx * 2]; // [1,2], [3,4], ...
  const keys = pair.map((i) => `${r32Base}::r32_${i}`);

  const { data } = await supabase
    .from("winners")
    .select("phase_key,color")
    .in("phase_key", keys);

  const map = Object.fromEntries((data || []).map((r) => [r.phase_key, r.color]));
  const pickFromR32 = (i, color) =>
    seedUrlFromKey(r32Base, color === "red" ? `A${i}` : `B${i}`);

  const cA = map[keys[0]];
  const cB = map[keys[1]];
  if (!(cA && cB)) return null;

  return { A: pickFromR32(pair[0], cA), B: pickFromR32(pair[1], cB) };
}

/** QF entrants from R16 winners (r16_1/2→qf1, 3/4→qf2, 5/6→qf3, 7/8→qf4) */
export async function getQFEntrantSourcesFromR16Winners(which /* qf1..qf4 */) {
  const r16Base = baseForCompletedStage("r16");
  if (!r16Base) return null;

  const slots = {
    qf1: ["r16_1", "r16_2"],
    qf2: ["r16_3", "r16_4"],
    qf3: ["r16_5", "r16_6"],
    qf4: ["r16_7", "r16_8"],
  }[which];
  if (!slots) return null;

  const keys = slots.map((s) => `${r16Base}::${s}`);
  const { data } = await supabase
    .from("winners")
    .select("phase_key,color")
    .in("phase_key", keys);

  const colors = Object.fromEntries((data || []).map((r) => [r.phase_key, r.color?.toLowerCase()]));

  async function r16Pack(slot) {
    const key = `${r16Base}::${slot}`;
    if (imgCache.has(key)) return imgCache.get(key);
    const rebuilt = await getR16EntrantSourcesFromR32Winners(slot);
    if (rebuilt) imgCache.set(key, rebuilt);
    return rebuilt;
  }

  const pL = await r16Pack(slots[0]);
  const pR = await r16Pack(slots[1]);
  if (!(pL && pR)) return null;

  const leftSrc  = colors[keys[0]] === "red" ? pL.A : pL.B;
  const rightSrc = colors[keys[1]] === "red" ? pR.A : pR.B;
  return { A: leftSrc, B: rightSrc };
}

/** SF entrants from QF winners (qf1/2→sf1, qf3/4→sf2) */
export async function getSemiEntrantSourcesFromQFWinners(which /* sf1|sf2 */) {
  const qfBase = baseForCompletedStage("qf");
  if (!qfBase) return null;

  const slots = which === "sf1" ? ["qf1", "qf2"] : ["qf3", "qf4"];
  const keys = slots.map((s) => `${qfBase}::${s}`);

  const { data: winRows } = await supabase
    .from("winners")
    .select("phase_key,color")
    .in("phase_key", keys);

  const colors = Object.fromEntries(
    (winRows || []).map((r) => [r.phase_key, (r.color || "").toLowerCase()])
  );
  if (!(colors[keys[0]] && colors[keys[1]])) return null;

  async function qfPack(slot /* qf1..qf4 */) {
    const key = `${qfBase}::${slot}`;
    if (imgCache.has(key)) return imgCache.get(key);
    const rebuilt = await getQFEntrantSourcesFromR16Winners(slot);
    if (rebuilt) imgCache.set(key, rebuilt);
    return rebuilt;
  }

  const pLeft = await qfPack(slots[0]);
  const pRight = await qfPack(slots[1]);
  if (!(pLeft && pRight)) return null;

  const leftSrc  = colors[keys[0]] === "red" ? pLeft.A : pLeft.B;
  const rightSrc = colors[keys[1]] === "red" ? pRight.A : pRight.B;
  return { A: leftSrc, B: rightSrc };
}

/** Final entrants from SF winners */
export async function getFinalEntrantSourcesFromWinners() {
  const sfBase = baseForCompletedStage("sf");
  if (!sfBase) return null;

  const { sf1, sf2 } = semiKeysFor(sfBase);
  const { data: winRows } = await supabase
    .from("winners")
    .select("phase_key,color")
    .in("phase_key", [sf1, sf2]);

  const colors = Object.fromEntries(
    (winRows || []).map((r) => [r.phase_key, (r.color || "").toLowerCase()])
  );
  const c1 = colors[sf1];
  const c2 = colors[sf2];
  if (!(c1 && c2)) return null;

  async function sfPack(slot /* sf1|sf2 */) {
    const key = `${sfBase}::${slot}`;
    if (imgCache.has(key)) return imgCache.get(key);
    const rebuilt = await getSemiEntrantSourcesFromQFWinners(slot);
    if (rebuilt) imgCache.set(key, rebuilt);
    return rebuilt;
  }

  const p1 = await sfPack("sf1");
  const p2 = await sfPack("sf2");
  if (!(p1 && p2)) return null;

  const leftFinal  = c1 === "red" ? p1.A : p1.B;
  const rightFinal = c2 === "red" ? p2.A : p2.B;
  return { A: leftFinal, B: rightFinal };
}