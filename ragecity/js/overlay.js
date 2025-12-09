<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, viewport-fit=cover"
  />
  <title>Rage City — Proto</title>

  <!-- Your main site styles (keep this if you already had it) -->
  <link rel="stylesheet" href="../style.css" />

  <style>
    :root {
      --neon-green: #00ff55;
      --bg-dark: #050711;
      --bg-game: #090b18; /* dark blue area */
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      background: #000;
      color: var(--neon-green);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .rc-shell {
      min-height: 100vh;
      padding: 16px 12px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
    }

    .rc-top-bar {
      width: 100%;
      max-width: 900px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .rc-top-btn {
      flex: 1 1 0;
      border-radius: 999px;
      border: 2px solid var(--neon-green);
      background: rgba(0, 0, 0, 0.9);
      color: var(--neon-green);
      font-weight: 600;
      padding: 10px 14px;
      text-align: center;
      text-decoration: none;
      box-shadow: 0 0 18px rgba(0, 255, 85, 0.8);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 12px;
    }

    .rc-top-btn span.icon {
      margin-right: 6px;
    }

    .rc-top-btn.left {
      justify-content: flex-start;
    }

    .rc-top-btn.right {
      justify-content: flex-end;
    }

    .rc-top-btn::before {
      content: "";
      display: inline-block;
    }

    /* ——— GAME FRAME ——— */

    .rc-frame {
      width: 100%;
      max-width: 900px;
      border: 3px solid var(--neon-green);
      box-shadow: 0 0 30px rgba(0, 255, 85, 0.9);
      border-radius: 4px;
      padding: 8px;
      background: #000;
      display: flex;
      flex-direction: column;
      /* This is the key: make the frame take almost the whole screen height */
      flex: 1 1 auto;
      height: calc(100vh - 260px); /* adjust this number if you want more/less controls space */
    }

    /* Container that should be exactly the dark blue game area */
    #game-area {
      flex: 1 1 auto;
      width: 100%;
      background: var(--bg-game);
      position: relative;
      overflow: hidden;
    }

    /* Phaser will inject the canvas into this div */
    #phaser-container {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    /* Force the canvas to stretch to the full green box inside */
    #phaser-container canvas {
      width: 100% !important;
      height: 100% !important;
      display: block;
    }

    /* ——— CONTROLS ——— */

    .rc-controls-shell {
      width: 100%;
      max-width: 900px;
      margin-top: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }

    .rc-dpad-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 30px;
      width: 100%;
    }

    .rc-dpad {
      display: grid;
      grid-template-columns: repeat(3, 60px);
      grid-template-rows: repeat(3, 60px);
      gap: 8px;
      justify-content: center;
      align-items: center;
    }

    .rc-dpad button,
    .rc-btn-round {
      border-radius: 16px;
      border: 2px solid var(--neon-green);
      background: rgba(0, 0, 0, 0.9);
      color: var(--neon-green);
      font-size: 18px;
      font-weight: 600;
      box-shadow: 0 0 12px rgba(0, 255, 85, 0.9);
    }

    .rc-dpad button {
      width: 60px;
      height: 60px;
    }

    .rc-dpad .blank {
      border: none;
      box-shadow: none;
      background: transparent;
    }

    .rc-btn-round {
      width: 72px;
      height: 72px;
      border-radius: 50%;
    }

    .rc-controls-hint {
      margin-top: 8px;
      background: rgba(0, 0, 0, 0.85);
      color: #e5e5e5;
      padding: 10px 16px;
      border-radius: 999px;
      font-size: 11px;
      text-align: center;
      max-width: 620px;
    }

    @media (min-width: 768px) {
      .rc-shell {
        padding-bottom: 32px;
      }

      .rc-frame {
        height: calc(100vh - 230px);
      }
    }
  </style>
</head>
<body>
  <div class="rc-shell">
    <!-- Top buttons -->
    <div class="rc-top-bar">
      <button id="exitFullscreenBtn" class="rc-top-btn left">
        <span class="icon">⛶</span> EXIT FULLSCREEN
      </button>
      <a href="../menu.html" class="rc-top-btn right">
        ← Menu
      </a>
    </div>

    <!-- GAME FRAME (green box) -->
    <div class="rc-frame">
      <!-- This dark blue area will now stretch to fill the frame -->
      <div id="game-area">
        <div id="phaser-container"></div>
      </div>
    </div>

    <!-- Controls -->
    <div class="rc-controls-shell">
      <div class="rc-dpad-row">
        <div class="rc-dpad">
          <button class="blank" disabled></button>
          <button data-dir="up">▲</button>
          <button class="blank" disabled></button>

          <button data-dir="left">◀</button>
          <button class="blank" disabled></button>
          <button data-dir="right">▶</button>

          <button class="blank" disabled></button>
          <button data-dir="down">▼</button>
          <button class="blank" disabled></button>
        </div>

        <div style="display: flex; gap: 16px; align-items: center;">
          <button id="bButton" class="rc-btn-round">●</button>
          <button id="aButton" class="rc-btn-round">A</button>
        </div>
      </div>

      <div class="rc-controls-hint">
        Drag from top and touch the back button to exit full screen.
      </div>
    </div>
  </div>

  <!-- Phaser + your Rage City game script -->
  <script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
  <script src="../js/ragecity.js"></script>

  <script>
    // Hook up virtual buttons to Phaser input if you need it.
    // This assumes ragecity.js exposes a global called `rageCityInput`.
    // You can adjust to match whatever you’re actually using.

    const dirButtons = document.querySelectorAll("[data-dir]");
    dirButtons.forEach((btn) => {
      const dir = btn.getAttribute("data-dir");
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        window.rageCityInput &&
          window.rageCityInput.onDirectionPress &&
          window.rageCityInput.onDirectionPress(dir, true);
      });
      btn.addEventListener("touchend", (e) => {
        e.preventDefault();
        window.rageCityInput &&
          window.rageCityInput.onDirectionPress &&
          window.rageCityInput.onDirectionPress(dir, false);
      });
    });

    const aButton = document.getElementById("aButton");
    const bButton = document.getElementById("bButton");

    ["touchstart", "touchend"].forEach((evt) => {
      aButton.addEventListener(evt, (e) => {
        e.preventDefault();
        const down = evt === "touchstart";
        window.rageCityInput &&
          window.rageCityInput.onA &&
          window.rageCityInput.onA(down);
      });

      bButton.addEventListener(evt, (e) => {
        e.preventDefault();
        const down = evt === "touchstart";
        window.rageCityInput &&
          window.rageCityInput.onB &&
          window.rageCityInput.onB(down);
      });
    });

    // Exit fullscreen handler
    document
      .getElementById("exitFullscreenBtn")
      .addEventListener("click", () => {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else if (window.parent && window.parent.document.fullscreenElement) {
          // if this is inside an iframe
          window.parent.document.exitFullscreen();
        }
      });
  </script>
</body>
</html>