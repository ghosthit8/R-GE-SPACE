/* global Phaser */

const config = {
  type: Phaser.AUTO,
  width: 320,          // Game Boy-ish resolution
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
let wasd;

function preload() {
  // For now we don't need external assets.
}

function create() {
  // Simple "player" as a green square
  player = this.add.rectangle(160, 120, 16, 16, 0x39ff14);

  // Arrow keys
  cursors = this.input.keyboard.createCursorKeys();

  // WASD keys
  wasd = this.input.keyboard.addKeys({
    up: Phaser.Input.Keyboard.KeyCodes.W,
    left: Phaser.Input.Keyboard.KeyCodes.A,
    down: Phaser.Input.Keyboard.KeyCodes.S,
    right: Phaser.Input.Keyboard.KeyCodes.D
  });

  // Retro "A button" (Z / Enter)
  this.input.keyboard.addKeys({
    A: Phaser.Input.Keyboard.KeyCodes.Z,
    ENTER: Phaser.Input.Keyboard.KeyCodes.ENTER
  });

  // Later we'll use A/ENTER to "inspect art" or enter rooms
}

function update(time, delta) {
  const speed = 80; // pixels per second
  const dt = delta / 1000;

  let dx = 0;
  let dy = 0;

  // Arrow keys
  if (cursors.left.isDown) dx -= 1;
  if (cursors.right.isDown) dx += 1;
  if (cursors.up.isDown) dy -= 1;
  if (cursors.down.isDown) dy += 1;

  // WASD
  if (wasd.left.isDown) dx -= 1;
  if (wasd.right.isDown) dx += 1;
  if (wasd.up.isDown) dy -= 1;
  if (wasd.down.isDown) dy += 1;

  // Normalize diagonal movement a bit
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }

  player.x += dx * speed * dt;
  player.y += dy * speed * dt;
}

// Boot the game
new Phaser.Game(config);