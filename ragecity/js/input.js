// Input state shared by the scene update loop
const inputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  A: false,
  B: false
};

function setupKeyboard(scene) {
  scene.input.keyboard.on("keydown", (event) => {
    switch (event.code) {
      case "ArrowLeft":
      case "KeyA":
        inputState.left = true;
        break;
      case "ArrowRight":
      case "KeyD":
        inputState.right = true;
        break;
      case "ArrowUp":
      case "KeyW":
        inputState.up = true;
        break;
      case "ArrowDown":
      case "KeyS":
        inputState.down = true;
        break;
      case "KeyZ":
      case "Enter":
        inputState.A = true;
        break;
      case "KeyX":
        inputState.B = true;
        break;
    }
  });

  scene.input.keyboard.on("keyup", (event) => {
    switch (event.code) {
      case "ArrowLeft":
      case "KeyA":
        inputState.left = false;
        break;
      case "ArrowRight":
      case "KeyD":
        inputState.right = false;
        break;
      case "ArrowUp":
      case "KeyW":
        inputState.up = false;
        break;
      case "ArrowDown":
      case "KeyS":
        inputState.down = false;
        break;
      case "KeyZ":
      case "Enter":
        inputState.A = false;
        break;
      case "KeyX":
        inputState.B = false;
        break;
    }
  });
}

function setupTouchButton(id, key) {
  const el = document.getElementById(id);
  if (!el) return;

  function setPressed(pressed) {
    inputState[key] = pressed;
  }

  function start(e) {
    e.preventDefault();
    setPressed(true);
  }
  function end(e) {
    e.preventDefault();
    setPressed(false);
  }

  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", end);
  el.addEventListener("mouseleave", end);

  el.addEventListener("touchstart", start, { passive: false });
  el.addEventListener("touchend", end, { passive: false });
  el.addEventListener("touchcancel", end, { passive: false });
}