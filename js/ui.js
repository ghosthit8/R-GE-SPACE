// js/ui.js
// Lightweight UI helpers: fullscreen viewer + small utilities.
// Mirrors the behavior from your original inline handlers. 1

import {
  // DOM
  fsOverlay, fsImage, fsClose,
  // Current match images
  imgA, imgB,
} from "./core.js";

/* ---------------- Fullscreen viewer ---------------- */

export function openFullscreenFor(imgEl) {
  if (!imgEl || !imgEl.src) return;
  fsImage.src = imgEl.src;
  fsOverlay.classList.add("show");
}

export function closeFullscreen() {
  fsOverlay.classList.remove("show");
  fsImage.src = "";
}

/**
 * Attach click handlers to:
 * - each .fsbtn (uses data-target to find img)
 * - overlay close button
 * - click-on-backdrop to close
 * - Escape key
 */
export function initFullscreenControls() {
  // Buttons on tiles
  document.querySelectorAll(".fsbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const imgEl = document.getElementById(targetId);
      openFullscreenFor(imgEl);
    });
  });

  // Close button
  fsClose.addEventListener("click", closeFullscreen);

  // Click outside image closes
  fsOverlay.addEventListener("click", (e) => {
    if (e.target === fsOverlay) closeFullscreen();
  });

  // Escape closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fsOverlay.classList.contains("show")) {
      closeFullscreen();
    }
  });
}

/* ---------------- Tiny helpers ---------------- */

/** Safe-assign an <img> src, clearing when falsy. */
export function setImg(el, src) {
  if (!el) return;
  if (src) { el.src = src; el.loading = "eager"; el.decoding = "async"; }
  else { el.removeAttribute("src"); }
}

/** Convenience: set both current match images at once. */
export function setCurrentMatchImages({ A, B }) {
  setImg(imgA, A);
  setImg(imgB, B);
}