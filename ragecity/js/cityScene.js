// ============================================================
// cityScene.js  (TRIMMED VERSION)
//
// This file now ONLY handles the scene, movement, input,
// frames, sculpture, prompts, and overlay triggers.
// All Supabase + media helpers live in ragecity-gallery-helpers.js
// ============================================================

let player;
let promptText;
let galleryFrames = [];
let sculptureSpot = null;
let wallsGroup;
let prevA = false;
let prevB = false;
let prevX = false;
let prevY = false;

// ===== PROMPT POSITION CONTROL =====
const PROMPT_OFFSET = 100;

// Upload state
let paintingUploadInput = null;
let currentPaintingIndex = null;

console.log("[RageCity] CityScene.js (trimmed) loaded.");

// ============================================================
// PHASER SCENE
// ============================================================
function preload() {
  this.load.image(
    "artThumb",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1000&q=80"
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

  // ========== DEBUG OVERLAY ==========
  const dbg = scene.add.text(8, 8, "", {
    fontSize: "12px",
    color: "#39ff14",
    backgroundColor: "#000",
    padding: { x: 6, y: 4 }
  })
    .setScrollFactor(0)
    .setDepth(9999);

  let dbgLines = [];
  function logDbg(msg) {
    console.log(msg);
    dbgLines.push(String(msg));
    if (dbgLines.length > 4) dbgLines.shift();
    dbg.setText(dbgLines.join("\n"));
  }

  // ===== WALL HELPERS =====
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

  // ===== ROOM GEOMETRY (unchanged) =====
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

  // Draw outer/inner walls, diagonals, ledges (same as original)
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

  // ===== WALL COLLIDERS =====
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

  // ===== PLAYER =====
  player = this.add.rectangle(leftOuter - 20, doorCenterY, 20, 20, 0x39ff14);
  this.physics.add.existing(player);
  player.body.setCollideWorldBounds(true);
  this.physics.add.collider(player, wallsGroup);

  // ===== SCULPTURE / HITBOX =====
  const cubeX = w * 0.56;
  const cubeY = h * 0.62;
  const frontSize = 40; 
  const half = frontSize / 2;
  const backOffset = 8;

  const cube = this.add.graphics();
  cube.lineStyle(2, 0xffffff, 1);
  cube.strokeRect(cubeX - half, cubeY - half, frontSize, frontSize);
  cube.strokeRect(cubeX - half - backOffset, cubeY - half - backOffset, frontSize, frontSize);
  cube.lineBetween(cubeX - half, cubeY - half, cubeX - half - backOffset, cubeY - half - backOffset);
  cube.lineBetween(cubeX + half, cubeY - half, cubeX + half - backOffset, cubeY - half - backOffset);
  cube.lineBetween(cubeX - half, cubeY + half, cubeX - half - backOffset, cubeY + half - backOffset);
  cube.lineBetween(cubeX + half, cubeY + half, cubeX + half - backOffset, cubeY + half - backOffset);

  const core = this.add.graphics();
  core.lineStyle(3, 0x39ff14, 1);
  core.strokeRect(cubeX - 8, cubeY - 8, 16, 16);
  core.setDepth(2);

  sculptureSpot = { x: cubeX, y: cubeY, fullUrl: null };

  // Hitbox
  const hitPadLeft = 9;
  const hitPadRight = -8;
  const hitPadTop = 9;
  const hitPadBottom = -8;

  const hitLeft = (cubeX - half) - hitPadLeft;
  const hitRight = (cubeX + half) + hitPadRight;
  const hitTop = (cubeY - half) - hitPadTop;
  const hitBottom = (cubeY + half) + hitPadBottom;

  const hitW = Math.max(10, hitRight - hitLeft);
  const hitH = Math.max(10, hitBottom - hitTop);

  const sculptureHit = this.add.rectangle(hitLeft + hitW / 2, hitTop + hitH / 2, hitW, hitH, 0xff0000, 0);
  this.physics.add.existing(sculptureHit, true);
  wallsGroup.add(sculptureHit);

  if (window.__DEBUG_HITBOXES) {
    sculptureHit.setFillStyle(0xff0000, 0.22).setVisible(true).setDepth(999999);
  }

  // ===== PROMPT TEXT =====
  const promptY = bottomInner + PROMPT_OFFSET;
  promptText = this.add.text(w / 2, promptY, "", {
    fontFamily: "system-ui, sans-serif",
    fontSize: "18px",
    color: "#39ff14",
    align: "center"
  }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(9998).setVisible(false);

  this.scale.on("resize", (g) => {
    const newBottom = g.height - marginY - corridorWidth;
    promptText.setPosition(g.width / 2, newBottom + PROMPT_OFFSET);
  });

  // ===== FRAMES (just shapes, media loads via helpers) =====
  const imgDisplaySize = 26;
  galleryFrames = [];

  function addTrapezoidFrame(scene2, x, y, side) {
    const g = scene2.add.graphics();
    g.lineStyle(3, 0x39ff14, 1);
    const wTop = 18, wBottom = 28, h2 = 26, skew = 5;
    let points;

    if (side === "left") {
      points = [
        { x:-wBottom/2,y:-h2/2 },{ x:wTop/2,y:-h2/2+skew },
        { x:wTop/2,y:h2/2-skew },{ x:-wBottom/2,y:h2/2 }
      ];
    } else if (side === "right") {
      points = [
        { x:-wTop/2,y:-h2/2+skew },{ x:wBottom/2,y:-h2/2 },
        { x:wBottom/2,y:h2/2 },{ x:-wTop/2,y:h2/2-skew }
      ];
    } else if (side === "top") {
      points = [
        { x:-wBottom/2,y:-h2/2 },{ x:wBottom/2,y:-h2/2 },
        { x:wTop/2,y:h2/2 },{ x:-wTop/2,y:h2/2 }
      ];
    } else {
      points = [
        { x:-wTop/2,y:-h2/2 },{ x:wTop/2,y:-h2/2 },
        { x:wBottom/2,y:h2/2 },{ x:-wBottom/2,y:h2/2 }
      ];
    }

    g.beginPath();
    g.moveTo(x+points[0].x,y+points[0].y);
    for (let i=1;i<points.length;i++) g.lineTo(x+points[i].x,y+points[i].y);
    g.closePath(); g.strokePath();

    const gMat = scene2.add.graphics();
    gMat.lineStyle(2,0x1a8f3a,1).fillStyle(0x000000,1);
    const matScale = 0.78;
    gMat.beginPath();
    gMat.moveTo(x+points[0].x*matScale,y+points[0].y*matScale);
    for (let i=1;i<points.length;i++) gMat.lineTo(x+points[i].x*matScale,y+points[i].y*matScale);
    gMat.closePath(); gMat.fillPath(); gMat.strokePath();

    galleryFrames.push({
      x,y,side,
      frameGfx:g,matGfx:gMat,
      img:null,fullUrl:null,locked:false,
      localTexKey:null,mediaKind:null,mimeType:"",
      playIcon:null,storagePath:null,supTexKey:null,scene:null
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
    const t = topCount === 1 ? 0.5 : i/(topCount-1);
    addTrapezoidFrame(this, Phaser.Math.Linear(topStartX, topEndX, t), midTopY, "top");
  }

  const rightCount = 4;
  for (let i = 0; i < rightCount; i++) {
    const t = i/(rightCount-1);
    addTrapezoidFrame(this, midRightX, Phaser.Math.Linear(topInner + 40, bottomInner - 40, t), "right");
  }

  [ topInner + 55, gapInnerTopY - 22 ].forEach((y) => {
    addTrapezoidFrame(this, midLeftX, y, "left");
  });

  const bottomPositions = [
    leftInner + 24, leftInner + 90,
    (leftInner + rightInner) / 2,
    rightInner - 90, rightInner - 24
  ];
  bottomPositions.forEach((x) => {
    addTrapezoidFrame(this, x, midBottomY, "bottom");
  });

  console.log("[RageCity] Total frames:", galleryFrames.length);

  // ===== LOAD MEDIA (via helper file) =====
  loadPaintingsFromSupabase(this, imgDisplaySize);

  // ===== INPUT HOOKS =====
  setupKeyboard(this);
  setupTouchButton("btn-left", "left");
  setupTouchButton("btn-right", "right");
  setupTouchButton("btn-up", "up");
  setupTouchButton("btn-down", "down");
  setupTouchButton("btn-a", "A");
  setupTouchButton("btn-b", "B");
  setupTouchButton("btn-x", "X");
  setupTouchButton("btn-y", "Y");
  setupFullscreenButton();

  // ===== FILE PICKER =====
  paintingUploadInput = document.getElementById("paintingUpload");
  console.log("[RageCity] paintingUpload found?", !!paintingUploadInput);

  if (paintingUploadInput) {
    paintingUploadInput.addEventListener("change", function () {
      const file = this.files && this.files[0];
      if (!file || currentPaintingIndex === null) return this.value = "";

      const frameIndex = currentPaintingIndex;
      const frame = galleryFrames[frameIndex];
      if (!frame) return (this.value = "");

      frame.locked = true;
      frame.scene = scene;
      clearFrameMedia(frame);

      const texKeyLocal = `localPainting-${frameIndex}-${Date.now()}`;
      frame.localTexKey = texKeyLocal;

      try {
        const isVid = isVideoFile(file.type, file.name);
        frame.mimeType = file.type || (isVid ? "video/mp4" : "image");
        const blobUrl = URL.createObjectURL(file);

        // IMAGE preview
        if (!isVid) {
          const imgEl = new Image();
          imgEl.onload = () => {
            if (scene.textures.exists(texKeyLocal)) scene.textures.remove(texKeyLocal);
            scene.textures.addImage(texKeyLocal, imgEl);
            const phImg = scene.add.image(frame.x, frame.y, texKeyLocal)
              .setDisplaySize(imgDisplaySize, imgDisplaySize)
              .setDepth(10);
            frame.img = phImg;
            frame.mediaKind = "image";
            frame.fullUrl = blobUrl;
          };
          imgEl.src = blobUrl;
        } else {
          // VIDEO preview marker
          clearFrameMedia(frame);
          frame.mediaKind = "video";
          frame.fullUrl = blobUrl;
          attachVideoMarker(scene, frame);
        }

      } catch (_) {}

      // Upload → DB → Signed URL
      (async () => {
        const signedUrl = await uploadPaintingToSupabase(frameIndex, file);
        if (signedUrl) frame.fullUrl = signedUrl;
        frame.locked = false;
        paintingUploadInput.value = "";
      })();
    });
  }
}

// ============================================================
// FULLSCREEN BUTTON
// ============================================================
function setupFullscreenButton() {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const e = document.documentElement;
    if (!document.fullscreenElement) e.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  document.addEventListener("fullscreenchange", () => {
    btn.textContent = document.fullscreenElement ? "⛶ Exit Fullscreen" : "⛶ Fullscreen";
  });
}

// ============================================================
// UPDATE LOOP
// ============================================================
function update(time, delta) {
  if (!player || !player.body) return;

  const justPressedA = inputState.A && !prevA;
  const justPressedB = inputState.B && !prevB;

  prevA = inputState.A;
  prevB = inputState.B;
  prevX = inputState.X;
  prevY = inputState.Y;

  // Movement
  const speed = 120;
  let vx = (inputState.left ? -1 : 0) + (inputState.right ? 1 : 0);
  let vy = (inputState.up ? -1 : 0) + (inputState.down ? 1 : 0);
  if (vx || vy) {
    const l = Math.hypot(vx, vy);
    player.body.setVelocity((vx / l) * speed, (vy / l) * speed);
  } else {
    player.body.setVelocity(0, 0);
  }

  // Nearest item check
  let nearest = null;
  let nd = Infinity;
  galleryFrames.forEach((f, index) => {
    const d = Phaser.Math.Distance.Between(player.x, player.y, f.x, f.y);
    if (d < nd) { nd = d; nearest = { type: "painting", index }; }
  });

  if (sculptureSpot) {
    const d = Phaser.Math.Distance.Between(player.x, player.y, sculptureSpot.x, sculptureSpot.y);
    if (d < nd) nearest = { type: "sculpture" };
  }

  // Prompt text visibility
  if (promptText) {
    if (nearest && nd < 80) {
      promptText.setVisible(true);
      if (nearest.type === "sculpture") {
        promptText.setText("Press A to inspect sculpture");
      } else {
        const f = galleryFrames[nearest.index];
        promptText.setText(f?.fullUrl ? "Press A to view art\nPress B to replace art"
                                      : "Press A to add art");
      }
    } else promptText.setVisible(false);
  }

  // A button behavior
  if (nearest && nd < 60 && justPressedA) {
    if (nearest.type === "sculpture") {
      if (sculptureSpot.fullUrl) window.openArtOverlay({ url: sculptureSpot.fullUrl });
    } else {
      currentPaintingIndex = nearest.index;
      const f = galleryFrames[currentPaintingIndex];
      if (!f?.fullUrl) paintingUploadInput?.click();
      else window.openArtOverlay({ url: f.fullUrl, mimeType: f.mimeType || "" });
    }
  }

  // B button behavior → replace
  if (nearest?.type === "painting" && nd < 60 && justPressedB) {
    currentPaintingIndex = nearest.index;
    paintingUploadInput?.click();
  }
}