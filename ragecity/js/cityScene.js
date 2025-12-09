let player;
let promptText;
let galleryFrames = [];
let sculptureSpot = null;
let wallsGroup;
let prevA = false;
let prevB = false;
let paintingUploadInput = null;
let currentPaintingIndex = null;

function preload() {
  // You can remove this if you really want no remote loads at all.
  // Kept in case you use it elsewhere.
  this.load.image(
    "artThumb",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1000&q=80"
  );
}

function create() {
  const { width, height } = this.scale.gameSize;

  // Physics
  this.physics.world.setBounds(0, 0, width, height);
  wallsGroup = this.physics.add.staticGroup();

  // Player (green square)
  player = this.add.rectangle(width / 2, height - 80, 20, 20, 0x00ff00);
  this.physics.add.existing(player);
  player.body.setCollideWorldBounds(true);

  // Prompt text
  promptText = this.add
    .text(width / 2, height - 40, 'Press A to view art', {
      fontSize: "18px",
      color: "#00ff55",
      fontFamily: "monospace"
    })
    .setOrigin(0.5, 0.5);
  promptText.setVisible(false);

  // Scene reference globally so other scripts can call into it
  window.rageCityScene = this;

  // Build the room, frames, sculpture, etc.
  buildRoomAndFrames.call(this);

  // Collider with walls
  this.physics.add.collider(player, wallsGroup);

  // Handle resizing
  this.scale.on("resize", (gameSize) => {
    if (!gameSize) return;
    const w = gameSize.width;
    const h = gameSize.height;
    this.physics.world.setBounds(0, 0, w, h);
    if (promptText) promptText.setPosition(w / 2, h - 40);
  });

  // Hook up hidden <input type="file" id="paintingUpload"> for user art
  paintingUploadInput = document.getElementById("paintingUpload");
  if (paintingUploadInput) {
    paintingUploadInput.addEventListener("change", function (e) {
      const file = this.files && this.files[0];
      if (!file || currentPaintingIndex === null) return;

      const reader = new FileReader();
      reader.onload = function (ev) {
        const dataUrl = ev.target.result;
        const frame = galleryFrames[currentPaintingIndex];
        if (!frame || !window.rageCityScene) return;

        const sceneRef = window.rageCityScene;
        const texKey = `userPainting-${currentPaintingIndex}`;

        // Remove previous texture for this slot if there was one
        if (sceneRef.textures.exists(texKey)) {
          sceneRef.textures.remove(texKey);
        }

        sceneRef.textures.addBase64(texKey, dataUrl);

        // Remove previous thumbnail sprite if it existed
        if (frame.img) {
          frame.img.destroy();
        }

        // Create a small thumbnail inside the frame
        const img = sceneRef.add.image(frame.x, frame.y, texKey);
        img.setDisplaySize(26, 26);
        frame.img = img;

        // Store full data URL for fullscreen overlay
        frame.fullUrl = dataUrl;
      };

      reader.readAsDataURL(file);

      // Reset so the same file can be chosen again later if needed
      this.value = "";
    });
  }

  // Controls + fullscreen
  setupKeyboard(this);
  setupTouchButton("btn-left", "left");
  setupTouchButton("btn-right", "right");
  setupTouchButton("btn-up", "up");
  setupTouchButton("btn-down", "down");
  setupTouchButton("btn-A", "A");
  setupTouchButton("btn-B", "B");

  const fullscreenBtn = document.getElementById("fullscreen-btn");
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      const container = document.getElementById("phaser-container");
      if (!container) return;
      if (!document.fullscreenElement) {
        container.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });
  }
}

function buildRoomAndFrames() {
  const w = this.scale.gameSize.width;
  const h = this.scale.gameSize.height;

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

  // Gaps for the corridor (bottom side)
  const gapOuterWidth = 100;
  const gapInnerWidth = gapOuterWidth - 40;

  const gapOuterCenterX = (leftOuter + rightOuter) / 2;
  const gapOuterLeftX = gapOuterCenterX - gapOuterWidth / 2;
  const gapOuterRightX = gapOuterCenterX + gapOuterWidth / 2;

  const gapInnerCenterX = gapOuterCenterX + 8;
  const gapInnerLeftX = gapInnerCenterX - gapInnerWidth / 2;
  const gapInnerRightX = gapInnerCenterX + gapInnerWidth / 2;

  const gapOuterTopY = bottomOuter - corridorWidth;
  const gapOuterBotY = bottomOuter;
  const gapInnerTopY = bottomInner;
  const gapInnerBotY = bottomInner + corridorWidth - 4;

  // WALL LINES
  const wallGraphics = this.add.graphics();
  wallGraphics.lineStyle(3, 0xffffff, 1);

  // Outer rectangle
  wallGraphics.strokeRect(
    leftOuter,
    topOuter,
    rightOuter - leftOuter,
    bottomOuter - topOuter
  );

  // Inner rectangle
  wallGraphics.strokeRect(
    leftInner,
    topInner,
    rightInner - leftInner,
    bottomInner - topInner
  );

  // Remove corridor sections
  wallGraphics.clear();

  // Outer with gap
  wallGraphics.beginPath();
  wallGraphics.moveTo(leftOuter, topOuter);
  wallGraphics.lineTo(rightOuter, topOuter);
  wallGraphics.lineTo(rightOuter, bottomOuter);
  wallGraphics.lineTo(gapOuterRightX, bottomOuter);
  wallGraphics.moveTo(gapOuterLeftX, bottomOuter);
  wallGraphics.lineTo(leftOuter, bottomOuter);
  wallGraphics.lineTo(leftOuter, topOuter);
  wallGraphics.closePath();
  wallGraphics.strokePath();

  // Inner with gap
  wallGraphics.beginPath();
  wallGraphics.moveTo(leftInner, topInner);
  wallGraphics.lineTo(rightInner, topInner);
  wallGraphics.lineTo(rightInner, bottomInner);
  wallGraphics.lineTo(gapInnerRightX, bottomInner);
  wallGraphics.moveTo(gapInnerLeftX, bottomInner);
  wallGraphics.lineTo(leftInner, bottomInner);
  wallGraphics.lineTo(leftInner, topInner);
  wallGraphics.closePath();
  wallGraphics.strokePath();

  // Diagonals in corners
  const cornerOffset = 18;
  const diag = this.add.graphics();
  diag.lineStyle(3, 0xffffff, 1);

  const corners = [
    { outer: [leftOuter, topOuter], inner: [leftInner, topInner] },
    { outer: [rightOuter, topOuter], inner: [rightInner, topInner] },
    { outer: [rightOuter, bottomOuter], inner: [rightInner, bottomInner] },
    { outer: [leftOuter, bottomOuter], inner: [leftInner, bottomInner] }
  ];

  corners.forEach((c) => {
    const [ox, oy] = c.outer;
    const [ix, iy] = c.inner;
    const leftOuter = ox;
    const topOuter = oy;
    const rightOuter = ox;
    const bottomOuter = oy;
    const leftInner = ix;
    const topInner = iy;
    const rightInner = ix;
    const bottomInner = iy;

    const g = this.add.graphics();
    g.lineStyle(3, 0xffffff, 1);

    const points = [
      { x: ox, y: oy },
      { x: ix, y: iy }
    ];

    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    g.lineTo(points[1].x, points[1].y);
    g.strokePath();
  });

  // Barrier colliders for walls (outer & inner rectangles + corridor sides)
  const addWallRect = (x1, y1, x2, y2) => {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const width = Math.abs(x2 - x1) || 4;
    const height = Math.abs(y2 - y1) || 4;
    const wall = wallsGroup.create(midX, midY, null);
    wall.body.setSize(width, height);
    wall.body.setImmovable(true);
  };

  // Outer walls
  addWallRect(leftOuter, topOuter, rightOuter, topOuter);
  addWallRect(rightOuter, topOuter, rightOuter, bottomOuter);
  addWallRect(leftOuter, bottomOuter, rightOuter, bottomOuter);
  addWallRect(leftOuter, topOuter, leftOuter, gapOuterTopY);
  addWallRect(leftOuter, gapOuterBotY, leftOuter, bottomOuter);

  // Inner walls
  addWallRect(leftInner, topInner, rightInner, topInner);
  addWallRect(rightInner, topInner, rightInner, bottomInner);
  addWallRect(leftInner, bottomInner, rightInner, bottomInner);
  addWallRect(leftInner, topInner, leftInner, gapInnerTopY);
  addWallRect(leftInner, gapInnerBotY, leftInner, bottomInner);

  // Corridor vertical edges
  addWallRect(gapOuterLeftX, gapOuterTopY, gapOuterLeftX, gapOuterBotY);
  addWallRect(gapOuterRightX, gapOuterTopY, gapOuterRightX, gapOuterBotY);
  addWallRect(gapInnerLeftX, gapInnerTopY, gapInnerLeftX, gapInnerBotY);
  addWallRect(gapInnerRightX, gapInnerTopY, gapInnerRightX, gapInnerBotY);

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

  // ==== GALLERY FRAMES (all start black, no thumbnails) ====
  galleryFrames = [];

  const frameThickness = 3;
  const matInset = 6;
  const frameSize = 32;

  const makeFrame = (x, y, side) => {
    // Frame outline
    const g = this.add.graphics();
    g.lineStyle(frameThickness, 0xffffff, 1);
    g.strokeRect(
      x - frameSize / 2,
      y - frameSize / 2,
      frameSize,
      frameSize
    );

    // Black mat (inner filled square)
    const gMat = this.add.graphics();
    gMat.lineStyle(1, 0x00ff55, 0.6);
    gMat.fillStyle(0x000000, 1);
    gMat.fillRect(
      x - frameSize / 2 + matInset,
      y - frameSize / 2 + matInset,
      frameSize - matInset * 2,
      frameSize - matInset * 2
    );
    gMat.strokeRect(
      x - frameSize / 2 + matInset,
      y - frameSize / 2 + matInset,
      frameSize - matInset * 2,
      frameSize - matInset * 2
    );

    // No thumbnail yet — img will be created after the user uploads.
    galleryFrames.push({
      x,
      y,
      side,
      frameGfx: g,
      matGfx: gMat,
      img: null,
      fullUrl: null // will hold a data URL after upload
    });
  };

  // Distribute frames around the outer corridor walls
  const spacing = 70;

  // Top wall frames
  for (let x = leftInner + spacing; x < rightInner - spacing; x += spacing) {
    makeFrame(x, topInner + 16, "top");
  }

  // Bottom wall frames
  for (let x = leftInner + spacing; x < rightInner - spacing; x += spacing) {
    if (x < gapInnerLeftX - spacing || x > gapInnerRightX + spacing) {
      makeFrame(x, bottomInner - 16, "bottom");
    }
  }

  // Left wall frames
  for (let y = topInner + spacing; y < bottomInner - spacing; y += spacing) {
    makeFrame(leftInner + 16, y, "left");
  }

  // Right wall frames
  for (let y = topInner + spacing; y < bottomInner - spacing; y += spacing) {
    makeFrame(rightInner - 16, y, "right");
  }

  // ==== SCULPTURE CUBE (can also display art if you want later) ====
  const centerX = (leftOuter + rightOuter) / 2;
  const centerY = (topOuter + bottomOuter) / 2;
  const sculptureX = centerX + 35;
  const sculptureY = centerY + 60;

  const cube = this.add.graphics();
  cube.lineStyle(3, 0xffffff, 1);
  const s = 40;
  cube.strokeRect(sculptureX - s / 2, sculptureY - s / 2, s, s);
  cube.strokeRect(sculptureX - s / 4, sculptureY - s / 4, s / 2, s / 2);

  // collider for sculpture
  const sculptureCollider = wallsGroup.create(sculptureX, sculptureY, null);
  sculptureCollider.body.setSize(s, s);
  sculptureCollider.body.setImmovable(true);

  sculptureSpot = {
    x: sculptureX,
    y: sculptureY,
    fullUrl: null // can set later if you want sculpture art upload too
  };
}

function update(time, delta) {
  if (!player || !player.body) return;

  const justPressedA = inputState.A && !prevA;
  const justPressedB = inputState.B && !prevB;

  // If overlay is open, A = toggle fullscreen, B = close
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

  // Find the closest painting frame
  galleryFrames.forEach((f, index) => {
    const d = Phaser.Math.Distance.Between(player.x, player.y, f.x, f.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestItem = { type: "painting", index };
    }
  });

  // Compare with sculpture, if any
  if (sculptureSpot) {
    const d = Phaser.Math.Distance.Between(
      player.x,
      player.y,
      sculptureSpot.x,
      sculptureSpot.y
    );
    if (d < nearestDist) {
      nearestDist = d;
      nearestItem = { type: "sculpture" };
    }
  }

  if (promptText) {
    if (nearestItem && nearestDist < 80) {
      promptText.setVisible(true);
      if (nearestItem.type === "sculpture") {
        promptText.setText("Press A to inspect sculpture");
      } else {
        const frame = galleryFrames[nearestItem.index];
        const hasArt = frame && !!frame.fullUrl;
        promptText.setText(
          hasArt ? "Press A to view art" : "Press A to add art"
        );
      }
    } else {
      promptText.setVisible(false);
    }
  }

  // Interact on A
  if (nearestItem && nearestDist < 60 && justPressedA) {
    if (nearestItem.type === "sculpture") {
      if (sculptureSpot && sculptureSpot.fullUrl) {
        openArtOverlay(sculptureSpot.fullUrl);
      }
    } else {
      // painting
      currentPaintingIndex = nearestItem.index;
      const frame = galleryFrames[currentPaintingIndex];
      if (!frame) return;

      if (!frame.fullUrl) {
        // No art yet — open file picker so user can upload from phone
        if (paintingUploadInput) {
          paintingUploadInput.click();
        }
      } else {
        // Already has art — open overlay to view it
        openArtOverlay(frame.fullUrl);
      }
    }
  }

  prevA = inputState.A;
  prevB = inputState.B;
}