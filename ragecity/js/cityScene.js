let player;
let promptText;
let galleryFrames = [];
let sculptureSpot = null;
let nearestItem = null;

let cursors;
let wasdKeys;
let aButtonKey;
let bButtonKey;

let isFullscreen = false;
let debugText;
let lastTimerLog = 0;
let lastIntervalTick = 0;

/**
 * Simple performance debug helpers
 */
function logTimer(label, startTime) {
  const elapsed = performance.now() - startTime;
  console.log(`[${new Date().toLocaleTimeString()}] TIMER: ${label} ${elapsed.toFixed(1)}ms`);
}

function logNet(label, details = "") {
  console.log(
    `[${new Date().toLocaleTimeString()}] NET: ${label}${details ? " " + details : ""}`
  );
}

function createTimers(scene) {
  const rafStart = performance.now();
  function onFrame() {
    const now = performance.now();
    const delta = now - lastTimerLog;
    if (delta >= 16) {
      console.log(
        `[${new Date().toLocaleTimeString()}] TIMER: rAF ${(now - rafStart).toFixed(1)}ms`
      );
      lastTimerLog = now;
    }
    scene.time.addEvent({
      delay: 0,
      callback: () => {
        requestAnimationFrame(onFrame);
      }
    });
  }
  requestAnimationFrame(onFrame);

  setInterval(() => {
    const start = performance.now();
    lastIntervalTick = start;
    console.log(
      `[${new Date().toLocaleTimeString()}] TIMER: interval 1 tick ${(performance.now() - start).toFixed(1)}ms`
    );
  }, 1000);
}

export class CityScene extends Phaser.Scene {
  constructor() {
    super("CityScene");
  }

  preload() {
    this.load.image("player", "https://ghosthit8.github.io/assets/green_square.png");
    this.load.image("pedestal", "https://ghosthit8.github.io/assets/pedestal.png");
    this.load.image("frame", "https://ghosthit8.github.io/assets/frame.png");
    this.load.image("sculpture", "https://ghosthit8.github.io/assets/sculpture_cube.png");
  }

  create() {
    console.log("[RageCity] CityScene.create()");

    createTimers(this);

    const w = this.scale.width;
    const h = this.scale.height;

    this.physics.world.setBounds(0, 0, w, h);

    const graphics = this.add.graphics();
    graphics.lineStyle(4, 0x00ff00, 0.9);

    graphics.strokeRect(40, 40, w - 80, h - 160);

    const innerMargin = 100;
    graphics.strokeRect(
      40 + innerMargin,
      40 + innerMargin,
      w - 80 - innerMargin * 2,
      h - 160 - innerMargin * 2
    );

    graphics.beginPath();
    graphics.moveTo(40 + innerMargin, 40 + innerMargin);
    graphics.lineTo(w - 40 - innerMargin, h - 120 - innerMargin);
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(w - 40 - innerMargin, 40 + innerMargin);
    graphics.lineTo(40 + innerMargin, h - 120 - innerMargin);
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(w * 0.5, 40 + innerMargin);
    graphics.lineTo(w * 0.5, h - 120 - innerMargin);
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(40 + innerMargin, (40 + h - 120) * 0.5);
    graphics.lineTo(w - 40 - innerMargin, (40 + h - 120) * 0.5);
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(40, 40);
    graphics.lineTo(40 + 60, 40);
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(w - 40, 40);
    graphics.lineTo(w - 40 - 60, 40);
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(40, h - 120);
    graphics.lineTo(40 + 60, h - 120);
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(w - 40, h - 120);
    graphics.lineTo(w - 40 - 60, h - 120);
    graphics.strokePath();

    const topCenterX = w * 0.5;
    const topCenterY = 40 + innerMargin + 40;

    const bottomPedestalY = h - 120 - 80;
    const pedestalSpacing = 150;
    const leftPedestalX = topCenterX - pedestalSpacing;
    const rightPedestalX = topCenterX + pedestalSpacing;

    player = this.physics.add.sprite(topCenterX, bottomPedestalY + 100, "player");
    player.setCollideWorldBounds(true);

    promptText = this.add
      .text(w * 0.5, h - 60, "Press A to view art", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#00ff00"
      })
      .setOrigin(0.5);
    promptText.setAlpha(0);

    debugText = this.add
      .text(10, 10, "Debugger ready", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#00ff00",
        backgroundColor: "#00000080"
      })
      .setDepth(9999)
      .setScrollFactor(0);

    cursors = this.input.keyboard.createCursorKeys();
    wasdKeys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });

    aButtonKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    bButtonKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);

    const basePaintingUrl =
      "https://images.pexels.com/photos/17821281/pexels-photo-17821281/free-photo-of-abstract-lights.jpeg?auto=compress&cs=tinysrgb&w=1200";

    galleryFrames = [];

    const addTrapezoidFrame = (scene, x, y, frameIndexHint) => {
      const pedestal = scene.physics.add.staticImage(x, y, "pedestal");
      pedestal.setScale(1.1, 0.9).refreshBody();

      const frameY = y - 80;
      const frame = scene.add.image(x, frameY, "frame");
      frame.setScale(1.2);

      const pedCollider = scene.add.rectangle(x, y + 10, 80, 40);
      scene.physics.add.existing(pedCollider, true);

      galleryFrames.push({
        frameIndex: frameIndexHint,
        sprite: frame,
        pedestal: pedCollider,
        promptText: "Press A to view art",
        fullUrl: basePaintingUrl,
        distance: Number.MAX_VALUE
      });
    };

    addTrapezoidFrame(this, leftPedestalX, bottomPedestalY, 0);
    addTrapezoidFrame(this, topCenterX, bottomPedestalY, 1);
    addTrapezoidFrame(this, rightPedestalX, bottomPedestalY, 2);

    const allColliders = [];

    const borderThickness = 16;
    const worldRect = {
      left: 40,
      right: w - 40,
      top: 40,
      bottom: h - 120
    };

    const addWall = (x, y, width, height) => {
      const rect = this.add.rectangle(x, y, width, height);
      const body = this.physics.add.existing(rect, true);
      allColliders.push(rect);
      return rect;
    };

    addWall(
      worldRect.left + (w - 80) / 2,
      worldRect.top,
      w - 80,
      borderThickness
    );
    addWall(
      worldRect.left + (w - 80) / 2,
      worldRect.bottom,
      w - 80,
      borderThickness
    );
    addWall(
      worldRect.left,
      (worldRect.top + worldRect.bottom) / 2,
      borderThickness,
      worldRect.bottom - worldRect.top
    );
    addWall(
      worldRect.right,
      (worldRect.top + worldRect.bottom) / 2,
      borderThickness,
      worldRect.bottom - worldRect.top
    );

    const corridorWidth = 120;
    const mag = Math.sqrt(2) / 2;

    const diagonalLength =
      Math.sqrt(
        Math.pow(worldRect.right - worldRect.left, 2) +
          Math.pow(worldRect.bottom - worldRect.top, 2)
      ) + corridorWidth * 2;

    const centerX = (worldRect.left + worldRect.right) / 2;
    const centerY = (worldRect.top + worldRect.bottom) / 2;
    const offset = corridorWidth / 2;

    const diag1 = addWall(
      centerX - offset * mag,
      centerY - offset * mag,
      diagonalLength,
      corridorWidth
    );
    diag1.rotation = Math.PI / 4;

    const diag2 = addWall(
      centerX + offset * mag,
      centerY - offset * mag,
      diagonalLength,
      corridorWidth
    );
    diag2.rotation = -Math.PI / 4;

    const midRectWidth = w * 0.35;
    const midRectHeight = (h - 160) * 0.35;
    const midRectX = (worldRect.left + worldRect.right) / 2;
    const midRectY = (worldRect.top + worldRect.bottom) / 2;

    addWall(
      midRectX,
      midRectY - midRectHeight / 2,
      midRectWidth,
      borderThickness
    );
    addWall(
      midRectX,
      midRectY + midRectHeight / 2,
      midRectWidth,
      borderThickness
    );
    addWall(
      midRectX - midRectWidth / 2,
      midRectY,
      borderThickness,
      midRectHeight
    );
    addWall(
      midRectX + midRectWidth / 2,
      midRectY,
      borderThickness,
      midRectHeight
    );

    addWall(midRectX, worldRect.top + 90, 80, 24);
    addWall(midRectX, worldRect.bottom - 90, 80, 24);
    addWall(
      worldRect.left + 90,
      midRectY,
      24,
      80
    );
    addWall(
      worldRect.right - 90,
      midRectY,
      24,
      80
    );

    this.physics.add.collider(player, allColliders);
    galleryFrames.forEach(frame =>
      this.physics.add.collider(player, frame.pedestal)
    );

    // Load any saved art for each gallery frame from Supabase
    if (typeof loadFrameArtFromSupabase === "function") {
      loadFrameArtFromSupabase();
    }

    // ===== SCULPTURE CUBE =====

    const sculptureX = midRectX;
    const sculptureY = midRectY;

    const sculptureImage = this.add.image(sculptureX, sculptureY, "sculpture");
    sculptureImage.setScale(1.3);

    const sculptureCollider = this.add.rectangle(
      sculptureX,
      sculptureY + 20,
      100,
      100
    );
    this.physics.add.existing(sculptureCollider, true);

    sculptureSpot = {
      sprite: sculptureImage,
      collider: sculptureCollider,
      promptText: "Press A to view art"
    };

    this.physics.add.collider(player, sculptureCollider);

    this.cameras.main.startFollow(player, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.2);
  }

  update() {
    if (!player) return;

    const speed = 220;
    player.setVelocity(0);

    const leftPressed =
      cursors.left.isDown || wasdKeys.left.isDown || inputState.left;
    const rightPressed =
      cursors.right.isDown || wasdKeys.right.isDown || inputState.right;
    const upPressed =
      cursors.up.isDown || wasdKeys.up.isDown || inputState.up;
    const downPressed =
      cursors.down.isDown || wasdKeys.down.isDown || inputState.down;

    if (leftPressed) {
      player.setVelocityX(-speed);
    } else if (rightPressed) {
      player.setVelocityX(speed);
    }

    if (upPressed) {
      player.setVelocityY(-speed);
    } else if (downPressed) {
      player.setVelocityY(speed);
    }

    promptText.setAlpha(0);
    nearestItem = null;

    let closestDist = Number.MAX_VALUE;

    galleryFrames.forEach((frame, index) => {
      const dx = player.x - frame.pedestal.x;
      const dy = player.y - frame.pedestal.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      frame.distance = dist;
      if (dist < 160 && dist < closestDist) {
        closestDist = dist;
        nearestItem = {
          type: "painting",
          index,
          fullUrl: frame.fullUrl,
          promptText: frame.promptText || "Press A to view art"
        };
      }
    });

    if (sculptureSpot) {
      const dx = player.x - sculptureSpot.collider.x;
      const dy = player.y - sculptureSpot.collider.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 160 && dist < closestDist) {
        closestDist = dist;
        nearestItem = {
          type: "sculpture",
          fullUrl: null,
          promptText: sculptureSpot.promptText || "Press A to view art"
        };
      }
    }

    if (nearestItem) {
      promptText.setText(nearestItem.promptText || "Press A to view art");
      promptText.setAlpha(1);
    }

    const aJustDown =
      Phaser.Input.Keyboard.JustDown(aButtonKey) ||
      (inputState.a && !inputState._aWasDown);
    const bJustDown =
      Phaser.Input.Keyboard.JustDown(bButtonKey) ||
      (inputState.b && !inputState._bWasDown);

    inputState._aWasDown = inputState.a;
    inputState._bWasDown = inputState.b;

    if (aJustDown && nearestItem) {
      console.log("[RageCity] A pressed near:", nearestItem);

      if (nearestItem.type === "sculpture") {
        openSculptureOverlay();
      } else {
        const urlToUse = nearestItem.fullUrl || PAINTING_FULL_URL;
        console.log("[RageCity] Opening overlay with URL:", urlToUse);
        openArtOverlay(urlToUse);
      }
    }

    if (bJustDown) {
      console.log("[RageCity] B pressed");
      closeArtOverlay();
    }

    if (Phaser.Input.Keyboard.JustDown(cursors.space)) {
      isFullscreen = !isFullscreen;
      toggleArtFullscreen(isFullscreen);
    }

    const dbg = [];
    dbg.push(`Player: (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`);
    dbg.push(`Nearest: ${nearestItem ? nearestItem.type : "none"}`);
    if (nearestItem) {
      dbg.push(`Idx: ${nearestItem.index ?? "-"} hasUrl: ${!!nearestItem.fullUrl}`);
    }
    debugText.setText(dbg.join("\n"));
  }
}

/**
 * Load per-frame artwork from Supabase and attach public URLs to each gallery frame.
 * This lets each physical frame in Rage City show a different piece.
 */
async function loadFrameArtFromSupabase() {
  try {
    if (typeof supabase === "undefined") {
      console.warn(
        "[RageCity] Supabase client not available; using default gallery art."
      );
      return;
    }

    const { data, error } = await supabase
      .from("ragecity_frames")
      .select("frame_index, storage_path");

    if (error) {
      console.error("[RageCity] Failed to load ragecity_frames:", error);
      return;
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      console.log("[RageCity] No saved frame art yet; using defaults.");
      return;
    }

    const bucket = supabase.storage.from("ragecity-art");
    const byIndex = new Map();

    for (const row of data) {
      if (
        row &&
        typeof row.frame_index === "number" &&
        row.storage_path
      ) {
        byIndex.set(row.frame_index, row.storage_path);
      }
    }

    if (typeof galleryFrames === "undefined") {
      console.warn(
        "[RageCity] galleryFrames is not defined; cannot attach art URLs."
      );
      return;
    }

    galleryFrames.forEach((frame, index) => {
      const storagePath = byIndex.get(index);
      if (!storagePath) return;

      try {
        const { data: urlData, error: urlError } =
          bucket.getPublicUrl(storagePath);
        if (urlError) {
          console.error(
            "[RageCity] Failed to get public URL for",
            storagePath,
            urlError
          );
          return;
        }
        if (urlData && urlData.publicUrl) {
          frame.fullUrl = urlData.publicUrl;
          frame.frameIndex = index;
        }
      } catch (urlErr) {
        console.error(
          "[RageCity] Unexpected error resolving public URL for",
          storagePath,
          urlErr
        );
      }
    });

    console.log(
      "[RageCity] Frame art loaded from Supabase:",
      galleryFrames.map(f => ({
        frameIndex: f.frameIndex,
        hasArt: !!f.fullUrl
      }))
    );
  } catch (err) {
    console.error("[RageCity] Unexpected error in loadFrameArtFromSupabase:", err);
  }
}