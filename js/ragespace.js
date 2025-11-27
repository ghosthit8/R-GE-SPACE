/* global Phaser */

// Debug: let us know Phaser is loading
console.log('Rage City JS loaded');

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
  width: 320,
  height: 240,
  parent: 'game-container',
  pixelArt: true,
  backgroundColor: '#111122', // slightly blue so you see the game box
  scene: {
    preload,
    create,
    update
  }
};

let player;

function preload() {}

function create() {
  console.log('Phaser scene created');

  // Remove fallback text once game is running
  const fb = document.getElementById('game-fallback');
  if (fb) fb.style.display = 'none';

  // Big bright square in the middle
  player = this.add.rectangle(160, 120, 32, 32, 0x39ff14);

  setupKeyboard(this);
  setupTouchButton('btn-left', 'left');
  setupTouchButton('btn-right', 'right');
  setupTouchButton('btn-up', 'up');
  setupTouchButton('btn-down', 'down');
  setupTouchButton('btn-a', 'A');
  setupTouchButton('btn-b', 'B');
}

function setupKeyboard(scene) {
  scene.input.keyboard.on('keydown', event => {
    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        inputState.left = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        inputState.right = true;
        break;
      case 'ArrowUp':
      case 'KeyW':
        inputState.up = true;
        break;
      case 'ArrowDown':
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
}

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

  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', end);

  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
}

function update(time, delta) {
  if (!player) return;

  const speed = 90;
  const dt = delta / 1000;

  let dx = 0;
  let dy = 0;

  if (inputState.left) dx -= 1;
  if (inputState.right) dx += 1;
  if (inputState.up) dy -= 1;
  if (inputState.down) dy += 1;

  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }

  player.x += dx * speed * dt;
  player.y += dy * speed * dt;

  const margin = 16;
  player.x = Phaser.Math.Clamp(player.x, margin, config.width - margin);
  player.y = Phaser.Math.Clamp(player.y, margin, config.height - margin);
}

new Phaser.Game(config);