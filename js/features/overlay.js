// js/features/overlay.js
// Champion overlay: confetti burst (auto-stops after 5s) + typewriter text.
// Provides showChampion(color, finalBaseISO) used by main.js and realtime. 1

import {
  overlay, overlayArtImg, overlayClose,
  overlayTitle, overlaySubtitle, overlayMotto,
  confettiCanvas, imgCache, fsOverlay, fsClose
} from "../core.js?v=29";

import {
  countVotesFor,
  finalKeyFor,
  getFinalEntrantSourcesFromWinners,
} from "../services.js";

/* ---------------- Confetti (one burst; stop after 5s) ---------------- */

let _confettiRaf = null;

export function startConfetti() {
  const ctx = confettiCanvas.getContext("2d");
  const W = () => (confettiCanvas.width = innerWidth);
  const H = () => (confettiCanvas.height = innerHeight);
  W(); H();

  const cx = confettiCanvas.width / 2;
  const cy = confettiCanvas.height / 3;

  const N = 280;
  const parts = Array.from({ length: N }, () => {
    const ang = Math.random() * Math.PI * 2;
    const spd = 3 + Math.random() * 7;
    return {
      x: cx, y: cy,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      w: 3 + Math.floor(Math.random() * 7),
      h: 3 + Math.floor(Math.random() * 7),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: ["#39ff14","#7dff62","#00ffd5","#baffc9","#eaff00"][Math.floor(Math.random() * 5)],
    };
  });

  function step() {
    W(); H();
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    parts.forEach((p) => {
      p.vy += 0.04;           // gravity
      p.vx *= 0.995; p.vy *= 0.995; // drag
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;

      // wrap
      if (p.x < -20) p.x = confettiCanvas.width + 20;
      if (p.x > confettiCanvas.width + 20) p.x = -20;
      if (p.y < -20) p.y = confettiCanvas.height + 20;
      if (p.y > confettiCanvas.height + 20) p.y = -20;

      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    _confettiRaf = requestAnimationFrame(step);
  }

  cancelAnimationFrame(_confettiRaf);
  step();
  setTimeout(() => stopConfetti(), 5000);
}

export function stopConfetti() {
  if (_confettiRaf) cancelAnimationFrame(_confettiRaf);
  _confettiRaf = null;
  const c = confettiCanvas.getContext("2d");
  c.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

/* ---------------- Typewriter ---------------- */

let _typewriterToken = 0;

export async function typewriter(el, text, speed = 85) {
  const myToken = ++_typewriterToken;
  el.textContent = "";
  el.classList.add("type-caret");
  for (let i = 0; i < text.length; i++) {
    if (myToken !== _typewriterToken) return;
    el.textContent += text[i];
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, speed));
  }
  if (myToken === _typewriterToken) el.classList.remove("type-caret");
}

/* ---------------- Overlay open/close ---------------- */

let _openChampionBase = null;

/**
 * Show the champion overlay for the given final base ISO and winner color.
 * - Uses cached final A/B if available, otherwise rebuilds from winners.
 * - Plays one confetti burst; subtitle + motto typewriter. 2
 */
export async function showChampion(color, finalBaseISO) {
  if (_openChampionBase === finalBaseISO && overlay.classList.contains("show")) return;
  _openChampionBase = finalBaseISO;

  const finalKey = finalKeyFor(finalBaseISO);

  if (!imgCache.has(finalKey)) {
    const pack = await getFinalEntrantSourcesFromWinners();
    if (pack) imgCache.set(finalKey, pack);
  }

  const cached = imgCache.get(finalKey) || {};
  const src = color === "red" ? (cached.A || "") : (cached.B || "");
  overlayArtImg.src = src;

  overlayTitle.textContent = "CHAMPION";

  // Subtitle/motto (same vibe/logic as your file)
  const { r, b } = await countVotesFor(finalKey);
  const sub = r === b ? "Tie… random winner picked" : (color === "red" ? "Winner<3" : "Winner<3");
  const motto = "Glory to the machine. Your art devours the bracket";

  overlaySubtitle.textContent = "";
  overlayMotto.textContent = "";

  overlay.classList.add("show");
  startConfetti();

  (async () => {
    await typewriter(overlaySubtitle, sub,   95);
    await typewriter(overlayMotto,   motto,  85);
  })();
}

export function closeOverlay() {
  overlay.classList.remove("show");
  stopConfetti();
  overlayArtImg.removeAttribute("src");
  overlaySubtitle.textContent = "";
  overlayMotto.textContent = "";
  _typewriterToken++;       // cancel any in-flight typing
  _openChampionBase = null; // allow next final
}

export function initOverlay() {
  overlayClose.onclick = closeOverlay;
}