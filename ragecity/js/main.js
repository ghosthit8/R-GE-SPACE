// Phaser game config + boot for Rage City

const rageCityConfig = {
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  // IMPORTANT: this must match the div in your HTML
  // <div id="phaser-container"></div>
  parent: "phaser-container",
  pixelArt: false,
  backgroundColor: "#111122",
  scale: {
    // RESIZE lets the canvas stretch to fill the green frame
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
  // These come from CityScene.js
  scene: {
    preload,
    create,
    update
  }
};

// Wait for DOM loaded so the container div exists
window.addEventListener("load", () => {
  new Phaser.Game(rageCityConfig);
});