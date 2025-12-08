// input.js
// Global input state shared by the Phaser scene
window.inputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  A: false,
  B: false
};

// Optional tiny text debug helper – if you add a div#debug-text in HTML
function setDebugText(msg) {
  const el = document.getElementById("debug-text");
  if (el) el.textContent = msg;
}

// Internal helper so every change logs once
function setButtonState(button, isDown) {
  if (!window.inputState) window.inputState = {};
  if (window.inputState[button] === isDown) return;
  window.inputState[button] = isDown;

  console.log("RageCity input:", button, isDown ? "DOWN" : "UP");
  setDebugText(
    `Last: ${button} ${isDown ? "DOWN" : "UP"} | ` +
      `L:${window.inputState.left ? 1 : 0} ` +
      `R:${window.inputState.right ? 1 : 0} ` +
      `U:${window.inputState.up ? 1 : 0} ` +
      `D:${window.inputState.down ? 1 : 0} ` +
      `A:${window.inputState.A ? 1 : 0} ` +
      `B:${window.inputState.B ? 1 : 0}`
  );
}

// ====== KEYBOARD (works on desktop) ======
function setupKeyboard(scene) {
  if (!scene || !scene.input || !scene.input.keyboard) return;

  scene.input.keyboard.on("keydown", (event) => {
    switch (event.code) {
      case "ArrowLeft":
      case "KeyA":
        setButtonState("left", true);
        break;
      case "ArrowRight":
      case "KeyD":
        setButtonState("right", true);
        break;
      case "ArrowUp":
      case "KeyW":
        setButtonState("up", true);
        break;
      case "ArrowDown":
      case "KeyS":
        setButtonState("down", true);
        break;
      case "KeyJ":
      case "KeyZ":
      case "Space":
        setButtonState("A", true);
        break;
      case "KeyK":
      case "KeyX":
      case "Enter":
        setButtonState("B", true);
        break;
    }
  });

  scene.input.keyboard.on("keyup", (event) => {
    switch (event.code) {
      case "ArrowLeft":
      case "KeyA":
        setButtonState("left", false);
        break;
      case "ArrowRight":
      case "KeyD":
        setButtonState("right", false);
        break;
      case "ArrowUp":
      case "KeyW":
        setButtonState("up", false);
        break;
      case "ArrowDown":
      case "KeyS":
        setButtonState("down", false);
        break;
      case "KeyJ":
      case "KeyZ":
      case "Space":
        setButtonState("A", false);
        break;
      case "KeyK":
      case "KeyX":
      case "Enter":
        setButtonState("B", false);
        break;
    }
  });
}

// ====== TOUCH / MOUSE BUTTONS (mobile controls) ======
function setupTouchButton(elementId, buttonName) {
  const el = document.getElementById(elementId);
  if (!el) {
    console.warn("RageCity: touch button element not found:", elementId);
    return;
  }

  function setPressed(down) {
    setButtonState(buttonName, down);
    if (down) {
      el.classList.add("pressed");
    } else {
      el.classList.remove("pressed");
    }
  }

  function start(e) {
    e.preventDefault();
    setPressed(true);
  }

  function end(e) {
    e.preventDefault();
    setPressed(false);
  }

  // Mouse
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", end);
  el.addEventListener("mouseleave", end);

  // Touch
  el.addEventListener("touchstart", start, { passive: false });
  el.addEventListener("touchend", end, { passive: false });
  el.addEventListener("touchcancel", end, { passive: false });
}

// Expose functions globally so cityScene.js can call them
window.setupKeyboard = setupKeyboard;
window.setupTouchButton = setupTouchButton;