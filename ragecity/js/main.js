// Phaser game config + boot

const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  parent: "game-container",
  pixelArt: false,
  backgroundColor: "#111122",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: { preload, create, update }
};

new Phaser.Game(config);