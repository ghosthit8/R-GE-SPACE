let player;
let promptText;
let galleryFrames = [];
let sculptureSpot = null;
let wallsGroup;
let prevA = false;
let prevB = false;

function preload() {
  // Blank 1x1 black texture so frames start empty
  this.load.image(
    "artThumb",
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NkYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg=="
  );
}

function create() {
  const fb = document.getElementById("game-fallback");
  if (fb) fb.style.display = "none";

  const w = this.scale.width;
  const h = this.scale.height;

  this.physics.world.setBounds(0, 0, w, h);
  wallsGroup = this.physics.add.staticGroup();
  const scene = this;

  function addWallRect(x1, y1, x2, y2, thickness = 14) {
    if (x1 === x2 && y1 !== y2) {
      const height = Math.abs(y2 - y1);
      const centerY = (y1 + y2) / 2;
      const wall = scene.add.rectangle(x1, centerY, thickness, height, 0x00ff00, 0);
      wall.setVisible(false);
      scene.physics.add.existing(wall, true);
      wallsGroup.add(wall);
    } else if (y1 === y2 && x1 !== x2) {
      const width = Math.abs(x2 - x1);
      const centerX = (x1 + x2) / 2;
      const wall = scene.add.rectangle(centerX, y1, width, thickness, 0x00ff00, 0);
      wall.setVisible(false);
      scene.physics.add.existing(wall, true);
      wallsGroup.add(wall);
    }
  }

  function addWallBlock(x, y, size = 16) {
    const wall = scene.add.rectangle(x, y, size, size, 0x00ff00, 0);
    wall.setVisible(false);
    scene.physics.add.existing(wall, true);
    wallsGroup.add(wall);
  }

  // ==== ROOM GEOMETRY ====
  const marginX = 60;
  const marginY = 90;

  const leftOuter = marginX;
  const rightOuter = w - marginX;
  const topOuter = marginY;
  const bottomOuter = h - marginY;

  const corridorWidth = 32;
  const leftInner = leftOuter + corridorWidth;
  const rightInner = rightOuter - corridorWidth;
  const topInner = topOuter + corridorWidth;
  const bottomInner = bottomOuter - corridorWidth;

  const doorWidth = 90;

  const doorCenterY = topInner + (bottomInner - topInner) * 0.65;
  const gapOuterTopY = doorCenterY - doorWidth / 2;
  const gapOuterBotY = doorCenterY + doorWidth / 2;

  const gapInnerTopY = doorCenterY - doorWidth / 2;
  const gapInnerBotY = doorCenterY + doorWidth / 2;

  // Outer wall
  const wallOuter = this.add.graphics();
  wallOuter.lineStyle(4, 0xffffff, 1);
  wallOuter.beginPath();
  wallOuter.moveTo(leftOuter, topOuter);
  wallOuter.lineTo(rightOuter, topOuter);
  wallOuter.lineTo(rightOuter, bottomOuter);
  wallOuter.lineTo(leftOuter, bottomOuter);
  wallOuter.lineTo(leftOuter, gapOuterBotY);
  wallOuter.moveTo(leftOuter, gapOuterTopY);
  wallOuter.lineTo(leftOuter, topOuter);
  wallOuter.strokePath();

  // Inner wall
  const wallInner = this.add.graphics();
  wallInner.lineStyle(4, 0xffffff, 1);
  wallInner.beginPath();
  wallInner.moveTo(leftInner, topInner);
  wallInner.lineTo(rightInner, topInner);
  wallInner.lineTo(rightInner, bottomInner);
  wallInner.lineTo(leftInner, bottomInner);
  wallInner.lineTo(leftInner, gapInnerBotY);
  wallInner.moveTo(leftInner, gapInnerTopY);
  wallInner.lineTo(leftInner, topInner);
  wallInner.strokePath();

  // Diagonals
  const diag = this.add.graphics();
  diag.lineStyle(4, 0xffffff, 1);
  diag.beginPath();
  diag.moveTo(leftOuter, topOuter);
  diag.lineTo(leftInner, topInner);
  diag.moveTo(rightOuter, topOuter);
  diag.lineTo(rightInner, topInner);
  diag.moveTo(rightOuter, bottomOuter);
  diag.lineTo(rightInner, bottomInner);
  diag.moveTo(leftOuter, bottomOuter);
  diag.lineTo(leftInner, bottomInner);
  diag.strokePath();

  // Ledges
  const ledges = this.add.graphics();
  ledges.lineStyle(4, 0xffffff, 1);
  const ledgeLength = leftInner - leftOuter;
  const upperLedgeY = gapInnerTopY;
  const lowerLedgeY = gapInnerBotY;
  ledges.beginPath();
  ledges.moveTo(leftOuter, upperLedgeY);
  ledges.lineTo(leftOuter + ledgeLength, upperLedgeY);
  ledges.moveTo(leftOuter, lowerLedgeY);
  ledges.lineTo(leftOuter + ledgeLength, lowerLedgeY);
  ledges.strokePath();

  // WALL COLLIDERS
  addWallRect(leftOuter, topOuter, rightOuter, topOuter);
  addWallRect(rightOuter, topOuter, rightOuter, bottomOuter);
  addWallRect(leftOuter, bottomOuter, rightOuter, bottomOuter);
  addWallRect(leftOuter, topOuter, leftOuter, gapOuterTopY);
  addWallRect(leftOuter, gapOuterBotY, leftOuter, bottomOuter);

  addWallRect(leftInner, topInner, rightInner, topInner);
  addWallRect(rightInner, topInner, rightInner, bottomInner);
  addWallRect(leftInner, bottomInner, rightInner, bottomInner);
  addWallRect(leftInner, topInner, leftInner, gapInnerTopY);
  addWallRect(leftInner, gapInnerBotY, leftInner, bottomInner);

  addWallRect(leftOuter, upperLedgeY, leftOuter + ledgeLength, upperLedgeY);
  addWallRect(leftOuter, lowerLedgeY, leftOuter + ledgeLength, lowerLedgeY);

  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    let t = i / steps;
    let x = Phaser.Math.Linear(leftOuter, leftInner, t);
    let y = Phaser.Math.Linear(topOuter, topInner, t);
    addWallBlock(x, y, 14);
    x = Phaser.Math.Linear(rightOuter, rightInner, t);
    y = Phaser.Math.Linear(topOuter, topInner, t);
    addWallBlock(x, y, 14);
    x = Phaser.Math.Linear(rightOuter, rightInner, t);
    y = Phaser.Math.Linear(bottomOuter, bottomInner, t);
    addWallBlock(x, y, 14);
    x = Phaser.Math.Linear(leftOuter, leftInner, t);
    y = Phaser.Math.Linear(bottomOuter, bottomInner, t);
    addWallBlock(x, y, 14);
  }

  // Player
  player = this.add.rectangle(leftOuter - 20, doorCenterY, 20, 20, 0x39ff14);
  this.physics.add.existing(player);
  player.body.setCollideWorldBounds(true);
  this.physics.add.collider(player, wallsGroup);

  // FRAMES
  const tex = this.textures.get("artThumb").getSourceImage();
  const natW = tex.width;
  const natH = tex.height;
  const imgMaxW = 26;
  const imgMaxH = 26;
  const imgScale = Math.min(imgMaxW / natW, imgMaxH / natH);
  galleryFrames = [];

  function addTrapezoidFrame(scene2, x, y, side) {
    const g = scene2.add.graphics();
    g.lineStyle(3, 0x39ff14, 1);
    const wTop = 18;
    const wBottom = 28;
    const h2 = 26;
    const skew = 5;
    let points;
    if (side === "left") {
      points = [
        { x: -wBottom / 2, y: -h2 / 2 },
        { x:  wTop / 2,    y: -h2 / 2 + skew },
        { x:  wTop / 2,    y:  h2 / 2 - skew },
        { x: -wBottom / 2, y:  h2 / 2 }
      ];
    } else if (side === "right") {
      points = [
        { x: -wTop / 2,    y: -h2 / 2 + skew },
        { x:  wBottom / 2, y: -h2 / 2 },
        { x:  wBottom / 2, y:  h2 / 2 },
        { x: -wTop / 2,    y:  h2 / 2 - skew }
      ];
    } else if (side === "top") {
      points = [
        { x: -wBottom / 2, y: -h2 / 2 },
        { x:  wBottom / 2, y: -h2 / 2 },
        { x:  wTop / 2,    y:  h2 / 2 },
        { x: -wTop / 2,    y:  h2 / 2 }
      ];
    } else {
      points = [
        { x: -wTop / 2,    y: -h2 / 2 },
        { x:  wTop / 2,    y: -h2 / 2 },
        { x:  wBottom / 2, y:  h2 / 2 },
        { x: -wBottom / 2, y:  h2 / 2 }
      ];
    }

    g.beginPath();
    g.moveTo(x + points[0].x, y + points[0].y);
    for (let i = 1; i < points.length; i++) {
      g.lineTo(x + points[i].x, y + points[i].y);
    }
    g.closePath();
    g.strokePath();

    const gMat = scene2.add.graphics();
    gMat.lineStyle(2, 0x1a8f3a, 1);
    gMat.fillStyle(0x000000, 1);
    const matScale = 0.78;
    gMat.beginPath();
    gMat.moveTo(
      x + points[0].x * matScale,
      y + points[0].y * matScale
    );
    for (let i = 1; i < points.length; i++) {
      gMat.lineTo(
        x + points[i].x * matScale,
        y + points[i].y * matScale
      );
    }
    gMat.closePath();
    gMat.fillPath();
    gMat.strokePath();

    const img = scene2.add.image(x, y, "artThumb");
    img.setScale(imgScale * 0.9);

    galleryFrames.push({
      x,
      y,
      side,
      frameGfx: g,
      matGfx: gMat,
      img,
      fullUrl: null // start with no art bound
    });
  }

  const midLeftX   = (leftOuter  + leftInner)  / 2;
  const midRightX  = (rightOuter + rightInner) / 2;
  const midTopY    = (topOuter   + topInner)   / 2;
  const midBottomY = (bottomOuter+ bottomInner)/ 2;

  const topCount = 4;
  const topStartX = leftInner + 35;
  const topEndX   = rightInner - 35;
  for (let i = 0; i < topCount; i++) {
    const t = topCount === 1 ? 0.5 : i / (topCount - 1);
    const x = Phaser.Math.Linear(topStartX, topEndX, t);
    addTrapezoidFrame(this, x, midTopY, "top");
  }

  const rightCount = 4;
  for (let i = 0; i < rightCount; i++) {
    const t = i / (rightCount - 1);
    const y = Phaser.Math.Linear(topInner + 40, bottomInner - 40, t);
    addTrapezoidFrame(this, midRightX, y, "right");
  }

  const leftYPositions = [
    topInner + 55,
    gapInnerTopY - 22
  ];
  leftYPositions.forEach((y) => {
    addTrapezoidFrame(this, midLeftX, y, "left");
  });

  const bottomPositions = [
    leftInner + 24,
    leftInner + 90,
    (leftInner + rightInner) / 2,
    rightInner - 90,
    rightInner - 24
  ];
  bottomPositions.forEach((x) => {
    addTrapezoidFrame(this, x, midBottomY, "bottom");
  });

  // Expose frames globally so overlay.js can reach them
  window.galleryFrames = galleryFrames;

  // ===== SCULPTURE CUBE =====
  const centerX = (leftOuter + rightOuter) / 2;
  const centerY = (topOuter + bottomOuter) / 2;
  const sculptureX = centerX + 35;
  const sculptureY = centerY + 60;

  const cube = this.add.graphics();
  cube.lineStyle(3, 0xffffff, 1);

  const size = 46;   // outer front square
  const depth = 10;

  const frontX = sculptureX - size / 2;
  const frontY = sculptureY - size / 2;
  cube.strokeRect(frontX, frontY, size, size);

  const backX = frontX - depth;
  const backY = frontY - depth;
  cube.strokeRect(backX, backY, size, size);

  cube.beginPath();
  cube.moveTo(frontX, frontY);
  cube.lineTo(backX, backY);
  cube.moveTo(frontX + size, frontY);
  cube.lineTo(backX + size, backY);
  cube.moveTo(frontX, frontY + size);
  cube.lineTo(backX, backY + size);
  cube.moveTo(frontX + size, frontY + size);
  cube.lineTo(backX + size, backY + size);
  cube.strokePath();

  const innerSize = 22; // inner green
  const inner = this.add.rectangle(
    sculptureX,
    sculptureY,
    innerSize,
    innerSize,
    0x000000
  );
  inner.setStrokeStyle(2, 0x39ff14, 1);

  sculptureSpot = {
    x: sculptureX,
    y: sculptureY,
    fullUrl: SCULPTURE_FULL_URL,
    type: "sculpture"
  };

  // ===== SCULPTURE COLLIDER (adjustable on all sides) =====
  const midSize = (size + innerSize) / 2;

  const expandLeft   = 18;
  const expandRight  = -3;
  const expandTop    = 18;
  const expandBottom = -3;

  const colliderWidth  = midSize + expandLeft + expandRight;
  const colliderHeight = midSize + expandTop + expandBottom;

  const frontCollider = this.add.rectangle(
    sculptureX + (expandRight - expandLeft) / 2,
    sculptureY + (expandBottom - expandTop) / 2,
    colliderWidth,
    colliderHeight,
    0x00ff00,
    0
  );
  frontCollider.setVisible(false);
  this.physics.add.existing(frontCollider, true);
  wallsGroup.add(frontCollider);

  // prompt text
  promptText = this.add.text(w / 2, h - 40, "", {
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: "14px",
    color: "#39ff14"
  });
  promptText.setOrigin(0.5);
  promptText.setVisible(false);

  this.scale.on("resize", (gameSize) => {
    promptText.setPosition(gameSize.width / 2, gameSize.height - 40);
  });

  // controls + fullscreen
  setupKeyboard(this);
  setupTouchButton("btn-left", "left");
  setupTouchButton("btn-right", "right");
  setupTouchButton("btn-up", "up");
  setupTouchButton("btn-down", "down");
  setupTouchButton("btn-a", "A");
  setupTouchButton("btn-b", "B");
  setupFullscreenButton();

  if (artOverlayEl) {
    artOverlayEl.addEventListener("click", () => {
      if (artOpen) closeArtOverlay();
    });
  }

  // Load any existing frame art from Supabase
  loadFrameArtFromSupabase(this);
}

function setupFullscreenButton() {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
      if (elem.requestFullscreen) elem.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (!btn) return;
    btn.textContent = document.fullscreenElement
      ? "⛶ Exit Fullscreen"
      : "⛶ Fullscreen";
  });
}

// Load existing frame art from ragecity_frames + bucket
async function loadFrameArtFromSupabase(scene) {
  const supa = window.supabaseClient;
  if (!supa) return;

  try {
    const { data, error } = await supa
      .from("ragecity_frames")
      .select("frame_index, storage_path");

    if (error) {
      console.error("Error loading Rage City frames:", error);
      return;
    }

    if (!data) return;

    data.forEach((row) => {
      const { frame_index, storage_path } = row;
      const { data: pub } = supa
        .storage
        .from("ragecity-art")
        .getPublicUrl(storage_path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) return;

      // Reuse overlay's helper if available, otherwise do our own
      if (typeof applyUrlToFrame === "function") {
        applyUrlToFrame(frame_index, publicUrl);
      } else if (window.galleryFrames && window.galleryFrames[frame_index]) {
        const frame = window.galleryFrames[frame_index];
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () {
          const texKey = "frame_remote_" + frame_index;
          const game = scene.game;
          if (game && game.textures) {
            if (game.textures.exists(texKey)) game.textures.remove(texKey);
            game.textures.addImage(texKey, img);
            frame.img.setTexture(texKey);
            frame.fullUrl = publicUrl;
          }
        };
        img.src = publicUrl;
      }
    });
  } catch (err) {
    console.error("Unexpected error loading Rage City frames:", err);
  }
}

function update(time, delta) {
  if (!player || !player.body) return;

  const justPressedA = inputState.A && !prevA;
  const justPressedB = inputState.B && !prevB;

  // If the add-art menu is open:
  //  - A triggers the file picker
  //  - B closes the menu
  if (addArtOpen) {
    if (justPressedA) {
      if (typeof triggerAddArtFilePicker === "function") {
        triggerAddArtFilePicker();
      }
    } else if (justPressedB) {
      closeAddArtMenu();
    }
    prevA = inputState.A;
    prevB = inputState.B;
    return;
  }

  // If we're viewing art, keep existing fullscreen / close behavior
  if (artOpen) {
    if (justPressedA) toggleArtFullscreen();
    if (justPressedB) closeArtOverlay();
    prevA = inputState.A;
    prevB = inputState.B;
    return;
  }

  const speed = 120;
  let vx = 0;
  let vy = 0;

  if (inputState.left) vx -= 1;
  if (inputState.right) vx += 1;
  if (inputState.up) vy -= 1;
  if (inputState.down) vy += 1;

  if (vx !== 0 || vy !== 0) {
    const len = Math.sqrt(vx * vx + vy * vy);
    vx = (vx / len) * speed;
    vy = (vy / len) * speed;
  }

  player.body.setVelocity(vx, vy);

  let nearestItem = null;
  let nearestDist = Infinity;

  // Look for nearest painting frame
  galleryFrames.forEach((f, idx) => {
    const d = Phaser.Math.Distance.Between(player.x, player.y, f.x, f.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestItem = {
        type: "painting",
        fullUrl: f.fullUrl,
        frameIndex: idx
      };
    }
  });

  // Compare with sculpture spot
  if (sculptureSpot) {
    const d = Phaser.Math.Distance.Between(
      player.x,
      player.y,
      sculptureSpot.x,
      sculptureSpot.y
    );
    if (d < nearestDist) {
      nearestDist = d;
      nearestItem = {
        type: "sculpture",
        fullUrl: sculptureSpot.fullUrl
      };
    }
  }

  // Prompt text
  if (promptText) {
    if (nearestItem && nearestDist < 80) {
      promptText.setVisible(true);
      if (nearestItem.type === "sculpture") {
        promptText.setText("Press A to inspect sculpture");
      } else {
        // painting
        promptText.setText(
          nearestItem.fullUrl ? "Press A to view art" : "Press A to add art"
        );
      }
    } else {
      promptText.setVisible(false);
    }
  }

  // Interaction when pressing A near something
  if (nearestItem && nearestDist < 60 && justPressedA) {
    if (nearestItem.type === "sculpture") {
      if (nearestItem.fullUrl) {
        openArtOverlay(nearestItem.fullUrl);
      }
    } else if (nearestItem.type === "painting") {
      if (nearestItem.fullUrl) {
        // has art → view it
        openArtOverlay(nearestItem.fullUrl);
      } else {
        // empty frame → open add-art menu
        openAddArtMenu(nearestItem.frameIndex);
      }
    }
  }

  prevA = inputState.A;
  prevB = inputState.B;
}