// Phaser game config + boot

const GAME_WIDTH = 960;
const GAME_HEIGHT = 540;

const config = {
  type: Phaser.AUTO,
  parent: "game-container",

  // Base game resolution
  width: GAME_WIDTH,
  height: GAME_HEIGHT,

  pixelArt: false,
  backgroundColor: "#111122",

  scale: {
    // <-- KEY CHANGE: use FIT instead of RESIZE
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,

    // tell the scaler what "native" size is
    width: GAME_WIDTH,
    height: GAME_HEIGHT
  },

  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },

  // CityScene functions come from cityScene.js
  scene: { preload, create, update }
};

new Phaser.Game(config);