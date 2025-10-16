// js/features/bracket.js
// Bracket UI: labels, thumbnails, scores, and row click wiring (robust).

import {
  brows, imgCache, baseForSlot, rowId, currentPhaseKey, seedUrlFromKey,
} from "../core.js";

import {
  countVotesFor, getR16EntrantSourcesFromR32Winners,
  getQFEntrantSourcesFromR16Winners, getSemiEntrantSourcesFromQFWinners,
  getFinalEntrantSourcesFromWinners, finalKeyFor,
} from "../services.js";

/* ---- label helpers ---- */
export function labelFor(slot) {
  if (slot.startsWith("r32")) {
    const n = Number(slot.split("_")[1]);
    const seeds = [
      "A vs B","C vs D","E vs F","G vs H","I vs J","K vs L","M vs N","O vs P",
      "Q vs R","S vs T","U vs V","W vs X","Y vs Z","AA vs AB","AC vs AD","AE vs AF"
    ];
    return { round: "R32", title: `Seed ${seeds[n-1] || "A vs B"}` };
  }
  if (slot.startsWith("r16")) {
    const n = Number(slot.split("_")[1]);
    const seeds = [
      "R32 1/2","R32 3/4","R32 5/6","R32 7/8","R32 9/10","R32 11/12","R32 13/14","R32 15/16"
    ];
    return { round: "R16", title: `Winners of ${seeds[n-1] || "R32"}` };
  }
  if (slot.startsWith("qf")) {
    const labels = { qf1:"Winners of R16 1/2", qf2:"Winners of R16 3/4", qf3:"Winners of R16 5/6", qf4:"Winners of R16 7/8" };
    return { round: "QF", title: labels[slot] || "Quarter Finals" };
  }
  if (slot === "sf1" || slot === "sf2") return { round: "SF", title: "Semifinals" };
  return { round: "Final", title: "TBD vs TBD" };
}

export function slotKeyFor(slot, baseISO) {
  return slot === "final" ? finalKeyFor(baseISO) : `${baseISO}::${slot}`;
}

/* ---- thumbnails ---- */
async function safeGet(fn) { try { return await fn(); } catch(e){ console.warn("[bracket] thumb:", e); return null; } }

async function thumbsFor(slot) {
  const base = baseForSlot(slot);
  if (!base) return { A: "", B: "" };

  const key = slotKeyFor(slot, base);
  if (imgCache.has(key)) return imgCache.get(key);

  if (slot.startsWith("r32")) {
    const idx = Number(slot.split("_")[1]); // 1..16
    const pack = { A: seedUrlFromKey(base, `A${idx}`), B: seedUrlFromKey(base, `B${idx}`) };
    imgCache.set(key, pack);
    return pack;
  }

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
  if (slot === "final") {
    const finals = await safeGet(() => getFinalEntrantSourcesFromWinners());
    if (finals) { imgCache.set(key, finals); return finals; }
    return { A: "", B: "" };
  }
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
  // If the server hasn't given us a phase yet, synthesize a base so R32 can render.
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