// js/champion-overlay.js
(() => {
  // --- 1. Inject CSS into <head> ---
  const css = `
  /* === CHAMPION OVERLAY (injected) === */
  .champion-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(circle at top, rgba(57,255,20,0.14), transparent 55%),
      rgba(0,0,0,0.88);
    backdrop-filter: blur(4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.35s ease;
  }
  .champion-overlay.active {
    opacity: 1;
    pointer-events: auto;
  }
  #championConfetti {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
  }
  .champion-card {
    position: relative;
    max-width: 480px;
    width: calc(100% - 32px);
    background: linear-gradient(135deg, #050608, #10151d);
    border-radius: 20px;
    border: 1px solid rgba(57,255,20,0.5);
    box-shadow:
      0 0 24px rgba(57,255,20,0.4),
      0 0 0 1px rgba(0,0,0,0.8) inset;
    padding: 18px 18px 20px;
    overflow: hidden;
    color: #e5e7eb;
  }
  .champion-scanlines::before {
    content: "";
    position: absolute;
    inset: -1px;
    background-image: linear-gradient(
      rgba(255,255,255,0.05) 1px,
      transparent 1px
    );
    background-size: 100% 3px;
    mix-blend-mode: soft-light;
    opacity: 0.65;
    pointer-events: none;
    animation: champion-scan 8s linear infinite;
  }
  @keyframes champion-scan {
    0%   { transform: translateY(0); }
    100% { transform: translateY(6px); }
  }
  .champion-close {
    position: absolute;
    top: 10px;
    right: 10px;
    border: none;
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 14px;
    background: rgba(12,16,20,0.9);
    color: #f9fafb;
    cursor: pointer;
    box-shadow: 0 0 0 1px rgba(148,163,184,0.6);
    transition: background 0.15s ease, transform 0.1s ease;
  }
  .champion-close:active {
    transform: scale(0.95);
  }
  .champion-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    margin-bottom: 10px;
    border-radius: 999px;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    background: radial-gradient(circle at top left, #39ff14, #111827);
    color: #020617;
    box-shadow: 0 0 14px rgba(57,255,20,0.4);
  }
  .champion-main {
    display: flex;
    gap: 14px;
    align-items: stretch;
  }
  .champion-image-wrap {
    flex: 0 0 44%;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid rgba(15,23,42,0.8);
    background:
      radial-gradient(circle at top, rgba(255,0,51,0.35), transparent 60%),
      #020617;
    position: relative;
  }
  .champion-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    mix-blend-mode: screen;
  }
  .champion-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
  }
  .champion-title {
    font-family: "Orbitron", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    letter-spacing: 0.18em;
    font-size: 13px;
    text-transform: uppercase;
    color: #39ff14;
    text-shadow:
      0 0 8px rgba(57,255,20,0.9),
      0 0 18px rgba(255,0,51,0.6);
  }
  .champion-label {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  /* Neon typewriter tagline – exactly two lines */
  .champion-tagline {
    font-size: 12px;
    color: #39ff14;
    font-family: "Source Code Pro", ui-monospace, monospace;
    letter-spacing: 0.04em;
    margin-top: 4px;
    overflow: hidden;
    display: inline-block;
    max-width: 100%;
    line-height: 1.3;
    border-right: 2px solid #39ff14;
    animation:
      champion-typing 4.5s steps(40, end) 0.4s 1 both,
      champion-blink 0.95s step-end infinite;
  }
  .champion-tagline span {
    display: block;          /* forces a new line for each */
    white-space: nowrap;     /* prevent each line from wrapping again */
  }

  @keyframes champion-typing {
    from { width: 0; }
    to   { width: 100%; }
  }
  @keyframes champion-blink {
    0%, 100% { border-color: #39ff14; }
    50%      { border-color: transparent; }
  }

  /* Tiny tweak on narrow phones so the long line fits */
  @media (max-width: 420px) {
    .champion-tagline {
      font-size: 11px;
    }
  }

  @media (max-width: 520px) {
    .champion-main {
      flex-direction: column;
    }
    .champion-image-wrap {
      flex: 0 0 auto;
      height: 220px;
    }
  }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // --- 2. Inject overlay HTML into <body> ---
  const overlay = document.createElement("div");
  overlay.id = "championOverlay";
  overlay.className = "champion-overlay";
  overlay.innerHTML = `
    <canvas id="championConfetti"></canvas>
    <div class="champion-card champion-scanlines">
      <button class="champion-close" aria-label="Close champion overlay">✕</button>
      <div class="champion-pill">FINAL CHAMPION</div>
      <div class="champion-main">
        <div class="champion-image-wrap">
          <img src="" alt="Champion artwork" class="champion-image" id="championImage">
        </div>
        <div class="champion-text">
          <div class="champion-title">CHAMPION</div>
          <div class="champion-label" id="championLabel">#1 Seed</div>
          <div class="champion-tagline" id="championTagline">
            <span>Glory to the machine. Your art devours</span>
            <span>the bracket...</span>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector("#championImage");
  const labelEl = overlay.querySelector("#championLabel");
  const taglineEl = overlay.querySelector("#championTagline");
  const closeBtn = overlay.querySelector(".champion-close");
  const canvas = overlay.querySelector("#championConfetti");
  const ctx = canvas.getContext("2d");

  // --- 3. Confetti engine ---
  let particles = [];
  let rafId = null;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function initParticles() {
    particles = [];
    const count = 160;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        size: 3 + Math.random() * 4,
        speedY: 1 + Math.random() * 3,
        speedX: (Math.random() - 0.5) * 1.4,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  function drawParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.speedX;
      p.y += p.speedY;
      p.rotation += p.spin;

      if (p.y - p.size > canvas.height) {
        p.y = -10;
        p.x = Math.random() * canvas.width;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      const stripe = Math.random();
      const w = p.size * 1.8;
      const h = p.size * 0.8;

      ctx.globalAlpha = 0.9;
      if (stripe < 0.33) {
        ctx.fillStyle = "#39ff14";
      } else if (stripe < 0.66) {
        ctx.fillStyle = "#ff0033";
      } else {
        ctx.fillStyle = "#0ea5e9";
      }
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }

    rafId = window.requestAnimationFrame(drawParticles);
  }

  function startConfetti() {
    resizeCanvas();
    initParticles();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = window.requestAnimationFrame(drawParticles);
  }

  function stopConfetti() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // --- 4. Open/close overlay ---
  function closeOverlay() {
    overlay.classList.remove("active");
    stopConfetti();
  }

  // EXPORTED FUNCTION
  window.openChampionOverlay = function(label, imageUrl) {
    if (imgEl && imageUrl) imgEl.src = imageUrl;
    if (labelEl) labelEl.textContent = label || "Champion";

    // restart typewriter animation
    taglineEl.style.animation = "none";
    void taglineEl.offsetWidth;
    taglineEl.style.animation = "";

    overlay.classList.add("active");
    startConfetti();
  };

  closeBtn.addEventListener("click", closeOverlay);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("active")) {
      closeOverlay();
    }
  });

  window.addEventListener("resize", resizeCanvas);
})();