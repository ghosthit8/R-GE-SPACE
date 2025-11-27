/* global Phaser */

// Shared input state (keyboard + touch)
const inputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  A: false,
  B: false
};

const config = {
  type: Phaser.AUTO,
  width: 320, // Game area size inside the container
  height: 240,
  parent: 'game-container',
  pixelArt: true,
  backgroundColor: '#000000',
  scene: {
    preload,
    create,
    update
  }
};

let player;
let cursors;
let wasdKeys;

function preload() {
  // later we'll load tiles, sprites, etc
}

function create() {
  const scene = this;

  // Simple player (bright green square so you can see it)
  player = scene.add.rectangle(160, 120, 24, 24, 0x39ff14);

  // Keyboard: arrow keys
  cursors = scene.input.keyboard.createCursorKeys();

  // Keyboard: WASD
  wasdKeys = scene.input.keyboard.addKeys({
    up: Phaser.Input.Keyboard.KeyCodes.W,
    left: Phaser.Input.Keyboard.KeyCodes.A,
    down: Phaser.Input.Keyboard.KeyCodes.S,
    right: Phaser.Input.Keyboard.KeyCodes.D
  });

  // "A" action key: Z / ENTER
  scene.input.keyboard.addKeys({
    A: Phaser.Input.Keyboard.KeyCodes.Z,
    ENTER: Phaser.Input.Keyboard.KeyCodes.ENTER,
    B: Phaser.Input.Keyboard.KeyCodes.X
  });

  // Hook keyboard into inputState
  scene.input.keyboard.on('keydown', event => {
    switch (event.code) {
      case 'ArrowLeft':
        inputState.left = true;
        break;
      case 'ArrowRight':
        inputState.right = true;
        break;
      case 'ArrowUp':
        inputState.up = true;
        break;
      case 'ArrowDown':
        inputState.down = true;
        break;
      case 'KeyA':
        inputState.left = true;
        break;
      case 'KeyD':
        inputState.right = true;
        break;
      case 'KeyW':
        inputState.up = true;
        break;
      case 'KeyS':
        inputState.down = true;
        break;
      case 'KeyZ':
      case 'Enter':
        inputState.A = true;
        break;
      case 'KeyX':
        inputState.B = true;
        break;
    }
  });

  scene.input.keyboard.on('keyup', event => {
    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        inputState.left = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        inputState.right = false;
        break;
      case 'ArrowUp':
      case 'KeyW':
        inputState.up = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        inputState.down = false;
        break;
      case 'KeyZ':
      case 'Enter':
        inputState.A = false;
        break;
      case 'KeyX':
        inputState.B = false;
        break;
    }
  });

  // --- Touch controls: D-pad + A/B ---
  setupTouchButton('btn-left', 'left');
  setupTouchButton('btn-right', 'right');
  setupTouchButton('btn-up', 'up');
  setupTouchButton('btn-down', 'down');
  setupTouchButton('btn-a', 'A');
  setupTouchButton('btn-b', 'B');
}

// Attach touch / mouse to a button id and link to inputState[key]
function setupTouchButton(id, key) {
  const el = document.getElementById(id);
  if (!el) return;

  const setPressed = pressed => {
    inputState[key] = pressed;
  };

  const start = e => {
    e.preventDefault();
    setPressed(true);
  };
  const end = e => {
    e.preventDefault();
    setPressed(false);
  };

  // Mouse
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', end);

  // Touch
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
}

function update(time, delta) {
  const speed = 80; // px per second
  const dt = delta / 1000;

  let dx = 0;
  let dy = 0;

  // Combine all inputs into dx/dy
  if (inputState.left) dx -= 1;
  if (inputState.right) dx += 1;
  if (inputState.up) dy -= 1;
  if (inputState.down) dy += 1;

  // Normalize diagonal
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }

  player.x += dx * speed * dt;
  player.y += dy * speed * dt;

  // Simple bounds so you don't wander off-screen
  const margin = 8;
  player.x = Phaser.Math.Clamp(player.x, margin, config.width - margin);
  player.y = Phaser.Math.Clamp(player.y, margin, config.height - margin);

  // For now, just log A press (later this will open art / rooms)
  if (inputState.A) {
    // In the future: open room, inspect art, etc.
    // console.log('A pressed');
  }
}

// Boot the game
new Phaser.Game(config);