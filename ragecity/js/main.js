// Phaser game config + boot for RageCity

const GAME_WIDTH = 960;
const GAME_HEIGHT = 540;

const config = {
  type: Phaser.AUTO,
  parent: "game-container",

  // Base resolution of the playfield (keep this 16:9)
  width: GAME_WIDTH,
  height: GAME_HEIGHT,

  pixelArt: false,
  backgroundColor: "#111122",

  scale: {
    // IMPORTANT: keep proportions, don’t stretch.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,

    // Tell the scaler what our “native” size is
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

  // Scene functions are defined in CityScene.js
  scene: { preload, create, update }
};

new Phaser.Game(config);