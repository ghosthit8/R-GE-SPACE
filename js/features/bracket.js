// js/features/bracket.js
// Bracket UI: labels, thumbnails, scores, and row click wiring.
// Emits a CustomEvent instead of mutating state directly; main.js handles it.
// Behavior mirrors your inline implementation. 1

import {
  // DOM
  brows,
  // shared helpers/state
  imgCache,
  // stage math
  baseForSlot,
  // UI helpers
  rowId,
  // state readers
  currentPhaseKey,
  currentStage,
  // vote count timestamp setter (optional)
  setLastCountsAt,
} from "../core.js";

import {
  // data + entrants
  countVotesFor,
  getR16EntrantSourcesFromR32Winners,
  getQFEntrantSourcesFromR16Winners,
  getSemiEntrantSourcesFromQFWinners,
  getFinalEntrantSourcesFromWinners,
  finalKeyFor,
} from "../services.js";

/* ---------------- Label helpers (copy of your mapping) ---------------- */

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

/* ---------------- Thumbnails (reconstruct real A/B) ---------------- */

async function thumbsFor(slot) {
  const base = baseForSlot(slot);
  if (!base) return { A: "", B: "" };

  const key = slotKeyFor(slot, base);
  if (imgCache.has(key)) return imgCache.get(key);

  // Rebuild based on stage
  if (slot.startsWith("r16")) {
    const pack = await getR16EntrantSourcesFromR32Winners(slot);
    if (pack) { imgCache.set(key, pack); return pack; }
    return { A: "", B: "" };
  }
  if (slot.startsWith("qf")) {
    const pack = await getQFEntrantSourcesFromR16Winners(slot);
    if (pack) { imgCache.set(key, pack); return pack; }
    return { A: "", B: "" };
  }
  if (slot === "sf1" || slot === "sf2") {
    const pack = await getSemiEntrantSourcesFromQFWinners(slot);
    if (pack) { imgCache.set(key, pack); return pack; }
    return { A: "", B: "" };
  }
  if (slot === "final") {
    const finals = await getFinalEntrantSourcesFromWinners();
    if (finals) { imgCache.set(key, finals); return finals; }
    return { A: "", B: "" };
  }

  // R32 is seeded by the current base (already deterministic in painter),
  // but thumbs list relies on painter cache; if not present, leave blank.
  // (Painter will seed when user clicks into R32 rows.)
  return imgCache.get(key) || { A: "", B: "" };
}

/* ---------------- Score updater ---------------- */

export async function updateBracketScores(rowsOrder) {
  // rowsOrder passed in so caller controls which slots exist
  for (const slot of rowsOrder) {
    const base = baseForSlot(slot);
    if (!base) continue;
    const key = slotKeyFor(slot, base);
    const sEl = document.querySelector(`#${rowId(slot)} .bscore`);
    if (!sEl) continue;
    try {
      const { r, b } = await countVotesFor(key);
      sEl.textContent = `${r} - ${b}`;
      setLastCountsAt?.(Date.now());
    } catch {
      sEl.textContent = `0 - 0`;
    }
  }
}

/* ---------------- Title for Final row ---------------- */

export async function finalSeedsTitle() {
  // Matches your inline logic: only show "Finalists decided" when SF winners exist
  // at the appropriate previous base. For simplicity, we keep "TBD vs TBD" here.
  return "TBD vs TBD";
}

/* ---------------- Render ---------------- */

export async function renderBracket({ activeSlot, isSlotFinished, isSlotLive }) {
  const base = currentPhaseKey;
  if (!base) { brows.innerHTML = ""; return; }

  const rowsOrder = [
    "r32_1","r32_2","r32_3","r32_4","r32_5","r32_6","r32_7","r32_8",
    "r32_9","r32_10","r32_11","r32_12","r32_13","r32_14","r32_15","r32_16",
    "r16_1","r16_2","r16_3","r16_4","r16_5","r16_6","r16_7","r16_8",
    "qf1","qf2","qf3","qf4","sf1","sf2","final"
  ];

  const finalTitle = await finalSeedsTitle();

  const parts = await Promise.all(rowsOrder.map(async (slot) => {
    const { round, title } = slot === "final" ? { round: "Final", title: finalTitle } : labelFor(slot);
    const thumbs = await thumbsFor(slot);

    const decided = isSlotFinished(slot);
    const pillText = decided ? "round decided" : (isSlotLive(slot) ? "" : "locked");

    return `
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
    `;
  }));

  brows.innerHTML = parts.join("");

  // Row click -> emit event; main.js will update active slot & repaint
  brows.querySelectorAll(".brow").forEach((row) => {
    row.addEventListener("click", () => {
      const slot = row.dataset.slot;
      window.dispatchEvent(new CustomEvent("rs:switch-slot", { detail: { slot } }));
    });
  });

  // After render, populate scores
  await updateBracketScores(rowsOrder);
}

/* ---------------- Small helpers for main.js ---------------- */

export function highlightActiveRow(activeSlot) {
  document.querySelectorAll(".brow").forEach((el) => el.classList.remove("active"));
  const r = document.getElementById(rowId(activeSlot));
  if (r) r.classList.add("active");
}