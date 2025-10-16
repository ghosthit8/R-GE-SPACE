// js/features/bracket.js — bracket UI that always seeds R32 from a fixed pool

import {
  brows, imgCache, baseForSlot, rowId, currentPhaseKey,
  fixedSeedPair,
} from "../core.js";

import {
  countVotesFor, getR16EntrantSourcesFromR32Winners,
  getQFEntrantSourcesFromR16Winners, getSemiEntrantSourcesFromQFWinners,
  getFinalEntrantSourcesFromWinners, finalKeyFor,
} from "../services.js";

/* ---- labels ---- */
export function labelFor(slot) {
  if (slot.startsWith("r32")) {
    const n = Number(slot.split("_")[1]);
    return { round: "R32", title: `Seed ${n}` };
  }
  if (slot.startsWith("r16")) return { round: "R16", title: `Winners of R32` };
  if (slot.startsWith("qf"))  return { round: "QF",  title: `Winners of R16` };
  if (slot.startsWith("sf"))  return { round: "SF",  title: `Semifinals` };
  return { round: "Final", title: "Finals" };
}

export function slotKeyFor(slot, baseISO) {
  return slot === "final" ? finalKeyFor(baseISO) : `${baseISO}::${slot}`;
}

/* ---- thumbs ---- */
async function safeGet(fn){ try { return await fn(); } catch { return null; } }

async function thumbsFor(slot) {
  // R32 always uses fixed images → deterministic and offline-safe
  if (slot.startsWith("r32")) {
    const pack = fixedSeedPair(slot);
    const base = baseForSlot(slot) || new Date().toISOString();
    imgCache.set(slotKeyFor(slot, base), pack);
    return pack;
  }

  const base = baseForSlot(slot);
  if (!base) return { A: "", B: "" };
  const key = slotKeyFor(slot, base);
  if (imgCache.has(key)) return imgCache.get(key);

  if (slot.startsWith("r16")) {
    const pack = await safeGet(() => getR16EntrantSourcesFromR32Winners(slot));
    if (pack) { imgCache.set(key, pack); return pack; }
    return { A: "", B: "" };
  }
  if (slot.startsWith("qf")) {
    const pack = await safeGet(() => getQFEntrantSourcesFromR16Winners(slot));
    if (pack) { imgCache.set(key, pack); return pack; }
    return { A: "", B: "" };
  }
  if (slot === "sf1" || slot === "sf2") {
    const pack = await safeGet(() => getSemiEntrantSourcesFromQFWinners(slot));
    if (pack) { imgCache.set(key, pack); return pack; }
    return { A: "", B: "" };
  }
  // final
  const finals = await safeGet(() => getFinalEntrantSourcesFromWinners());
  if (finals) { imgCache.set(key, finals); return finals; }
  return { A: "", B: "" };
}

/* ---- scores ---- */
export async function updateBracketScores(rowsOrder) {
  for (const slot of rowsOrder) {
    const base = baseForSlot(slot);
    if (!base) continue;
    const key = slotKeyFor(slot, base);
    const sEl = document.querySelector(`#${rowId(slot)} .bscore`);
    if (!sEl) continue;
    try {
      const { r, b } = await countVotesFor(key);
      sEl.textContent = `${r} - ${b}`;
    } catch { sEl.textContent = `0 - 0`; }
  }
}

/* ---- render ---- */
export async function renderBracket({ activeSlot, isSlotFinished, isSlotLive }) {
  const base = currentPhaseKey || new Date().toISOString();
  if (!brows) return;

  const rowsOrder = [
    "r32_1","r32_2","r32_3","r32_4","r32_5","r32_6","r32_7","r32_8",
    "r32_9","r32_10","r32_11","r32_12","r32_13","r32_14","r32_15","r32_16",
    "r16_1","r16_2","r16_3","r16_4","r16_5","r16_6","r16_7","r16_8",
    "qf1","qf2","qf3","qf4","sf1","sf2","final"
  ];

  const parts = [];
  for (const slot of rowsOrder) {
    const { round, title } = labelFor(slot);
    let thumbs = { A: "", B: "" };
    try { thumbs = await thumbsFor(slot); } catch {}
    const decided = isSlotFinished(slot);
    const pillText = decided ? "round decided" : (isSlotLive(slot) ? "" : "locked");
    parts.push(`
      <div class="brow ${decided ? "decided" : ""} ${slot === activeSlot ? "active" : ""}"
           id="${rowId(slot)}" data-slot="${slot}">
        <div class="bbadge">${round}</div>
        <div class="thumb2">
          <div class="thumb">${thumbs.A ? `<img src="${thumbs.A}" alt="">` : ""}</div>
          <div class="thumb">${thumbs.B ? `<img src="${thumbs.B}" alt="">` : ""}</div>
        </div>
        <div class="bmeta">
          <div class="title">${title}</div>
          <div class="bline"><span class="bpill">${pillText}</span></div>
        </div>
        <div class="bscore">0 - 0</div>
      </div>
    `);
  }

  brows.innerHTML = parts.join("");
  brows.querySelectorAll(".brow").forEach((row) => {
    row.addEventListener("click", () => {
      const slot = row.dataset.slot;
      window.dispatchEvent(new CustomEvent("rs:switch-slot", { detail: { slot } }));
    });
  });

  try { await updateBracketScores(rowsOrder); } catch {}
}

/* ---- highlight ---- */
export function highlightActiveRow(activeSlot) {
  document.querySelectorAll(".brow").forEach((el) => el.classList.remove("active"));
  const r = document.getElementById(rowId(activeSlot));
  if (r) r.classList.add("active");
}