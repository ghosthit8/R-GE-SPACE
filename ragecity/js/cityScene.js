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
// Controls how far UNDER the inner green square the prompt sits.
// Smaller = higher, bigger = lower.
const PROMPT_OFFSET = 100;
// =================================

// For per-painting uploads
let paintingUploadInput = null;
let currentPaintingIndex = null;

// --- Supabase shared gallery config moved to ragecity-gallery-helpers.js ---

function preload() {
  // Not used for frames anymore, but safe to leave.
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

  console.log("[RageCity] Phaser scene created. World bounds:", { w, h });

  // ==========================
  // ✅ MOBILE DEBUG OVERLAY (last 4 lines)
  // ==========================
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

  function addWallRect(x1, y1, x2, y2, thickness = 14) {
    if (x1 === x2 && y1 !== y2) {
      const height = Math.abs(y2 - y1);
      const centerY = (y1 + y2) / 2;
      const wall = scene.add.rectangle(
        x1,
        centerY,
        thickness,
        height,
        0x00ff00,
        0
      );
      wall.setVisible(false);
      scene.physics.add.existing(wall, true);
      wallsGroup.add(wall);
    } else if (y1 === y2 && x1 !== x2) {
      const width = Math.abs(x2 - x1);
      const centerX = (x1 + x2) / 2;
      const wall = scene.add.rectangle(
        centerX,
        y1,
        width,
        thickness,
        0x00ff00,
        0
      );
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

  // ===== SCULPTURE CUBE (RESTORED - ORIGINAL LOOK) =====
  // Positioned/Scaled to match the older build (smaller, centered more inside the room)
  const cubeX = w * 0.56;
  const cubeY = h * 0.62;

  const frontSize = 40;          // old cube was smaller
  const half = frontSize / 2;
  const backOffset = 8;         // subtle 3D offset like before

  const cube = this.add.graphics();
  cube.lineStyle(2, 0xffffff, 1);

  // front face
  cube.strokeRect(cubeX - half, cubeY - half, frontSize, frontSize);

  // back face (slightly up-left) — FIXED orientation
  cube.strokeRect(
    cubeX - half - backOffset,
    cubeY - half - backOffset,
    frontSize,
    frontSize
  );

  // connecting edges
  cube.lineBetween(cubeX - half, cubeY - half, cubeX - half - backOffset, cubeY - half - backOffset);
  cube.lineBetween(cubeX + half, cubeY - half, cubeX + half - backOffset, cubeY - half - backOffset);
  cube.lineBetween(cubeX - half, cubeY + half, cubeX - half - backOffset, cubeY + half - backOffset);
  cube.lineBetween(cubeX + half, cubeY + half, cubeX + half - backOffset, cubeY + half - backOffset);

  // green core — OPEN (outline)
  const core = this.add.graphics();
  core.lineStyle(3, 0x39ff14, 1);
  core.strokeRect(cubeX - 8, cubeY - 8, 16, 16);
  core.setDepth(2);

  // interaction anchor
  sculptureSpot = {
    x: cubeX,
    y: cubeY,
    fullUrl: null
  };

  // --- SCULPTURE COLLIDER (independent per-side tuning) ---
  // Invisible static rectangle added to wallsGroup so the player cannot walk through the cube.
  // (Does NOT change any cube visuals.)

  // ✅ EDIT THESE 6 NUMBERS ONLY
  const hitPadLeft   = 9;   // space to the left of the cube
  const hitPadRight  = -8;   // space to the right of the cube
  const hitPadTop    = 9;    // space above the cube
  const hitPadBottom = -8;   // space below the cube
  const hitNudgeX    = 0;    // optional center nudge (X)
  const hitNudgeY    = 0;    // optional center nudge (Y)

  // derived rect (use per-side pads above)
  const hitLeft   = (cubeX - half) - hitPadLeft;
  const hitRight  = (cubeX + half) + hitPadRight;
  const hitTop    = (cubeY - half) - hitPadTop;
  const hitBottom = (cubeY + half) + hitPadBottom;

  const hitW = Math.max(10, hitRight - hitLeft);
  const hitH = Math.max(10, hitBottom - hitTop);
  const hitCX = hitLeft + hitW / 2 + hitNudgeX;
  const hitCY = hitTop + hitH / 2 + hitNudgeY;

  const sculptureHit = this.add.rectangle(hitCX, hitCY, hitW, hitH, 0xff0000, 0);
  this.physics.add.existing(sculptureHit, true); // static body
  if (typeof wallsGroup !== 'undefined' && wallsGroup && wallsGroup.add) {
    wallsGroup.add(sculptureHit);
  }

  // debug toggle: set window.__DEBUG_HITBOXES = true in console to see it
  const showHit = !!window.__DEBUG_HITBOXES;
  if (showHit) {
    sculptureHit.setFillStyle(0xff0000, 0.22);
    sculptureHit.setVisible(true);
    sculptureHit.setDepth(999999);
  } else {
    sculptureHit.setVisible(false);
  }

  // ✅ Interaction prompt (shows when near a frame)
  // Place it just under the inner green square (room boundary), not at the bottom of the screen
  const promptY = bottomInner + PROMPT_OFFSET;

  promptText = this.add.text(w / 2, promptY, "", {
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: "18px",
    color: "#39ff14",
    align: "center"
  });

  // ✅ PATCH: bottom-anchor so 2 lines grow UP (won't get cut off)
  promptText.setOrigin(0.5, 1);
  promptText.setLineSpacing(6);

  promptText.setScrollFactor(0);
  promptText.setDepth(9998);
  promptText.setVisible(false);

  // Keep prompt positioned correctly on resize / rotate
  this.scale.on("resize", (gameSize) => {
    // Recompute bottomInner for the NEW fullscreen/rotated height
    const newBottomOuter = gameSize.height - marginY;
    const newBottomInner = newBottomOuter - corridorWidth;

    // ✅ PATCH: keep same anchor logic
    promptText.setPosition(gameSize.width / 2, newBottomInner + PROMPT_OFFSET);
  });

  // FRAMES (start BLACK, Supabase will populate any that have art)
  const imgDisplaySize = 26;
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

    // Outer neon frame
    g.beginPath();
    g.moveTo(x + points[0].x, y + points[0].y);
    for (let i = 1; i < points.length; i++) {
      g.lineTo(x + points[i].x, y + points[i].y);
    }
    g.closePath();
    g.strokePath();

    // Black mat inside
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

    galleryFrames.push({
      x,
      y,
      side,
      frameGfx: g,
      matGfx: gMat,
      img: null,
      fullUrl: null,
      locked: false,
      localTexKey: null,
      mediaKind: null,
      mimeType: "",
      playIcon: null,
      storagePath: null,
      supTexKey: null,
      scene: null
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

  console.log("[RageCity] Total gallery frames:", galleryFrames.length);

  // Load shared gallery from Supabase
  loadPaintingsFromSupabase(this, imgDisplaySize);

  // controls + fullscreen
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

  // hook the hidden <input type="file" id="paintingUpload">
  paintingUploadInput = document.getElementById("paintingUpload");
  console.log("[RageCity] paintingUpload input found?", !!paintingUploadInput);

  if (paintingUploadInput) {
    paintingUploadInput.addEventListener("change", function () {
      const file = this.files && this.files[0];
      console.log("[RageCity] paintingUpload change event:", {
        hasFile: !!file,
        currentPaintingIndex,
      });

      if (!file || currentPaintingIndex === null) {
        this.value = "";
        return;
      }

      const frameIndex = currentPaintingIndex;
      const frame = galleryFrames[frameIndex];
      if (!frame) {
        console.warn("[RageCity] No frame found for index", frameIndex);
        this.value = "";
        return;
      }

      console.log("[RageCity] Selected file for frame:", {
        frameIndex,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });

      // lock while replacing so nothing overwrites mid-flight
      frame.locked = true;

      // Clear previous media (image/video/marker/texture)
      frame.scene = scene;
      clearFrameMedia(frame);

      // Unique texture key
      const texKeyLocal = `localPainting-${frameIndex}-${Date.now()}`;
      frame.localTexKey = texKeyLocal;

      // ✅ MOBILE-SAFE LOCAL PREVIEW
      try {
        const isVid = isVideoFile(file.type, file.name);
        frame.mimeType = file.type || (isVid ? "video/mp4" : "image");

        logDbg(isVid ? "Preview: video selected…" : "Preview: building blob…");

        const blobUrl = URL.createObjectURL(file);

        if (!isVid) {
          const imgEl = new Image();
          imgEl.crossOrigin = "anonymous";
          imgEl.onload = () => {
            if (frame.localTexKey !== texKeyLocal) {
              URL.revokeObjectURL(blobUrl);
              return;
            }

            logDbg("Preview: image loaded");

            if (scene.textures.exists(texKeyLocal)) {
              scene.textures.remove(texKeyLocal);
            }
            scene.textures.addImage(texKeyLocal, imgEl);

            const phImg = scene.add.image(frame.x, frame.y, texKeyLocal);
            phImg.setDisplaySize(imgDisplaySize, imgDisplaySize);
            phImg.setDepth(10);

            frame.img = phImg;
            frame.mediaKind = "image";

            scene.children.bringToTop(frame.img);

            frame.fullUrl = blobUrl;

            logDbg("Thumbnail rendered ✔");
          };

          imgEl.onerror = (e) => {
            console.warn("[RageCity] Preview image failed to load:", e);
            logDbg("Preview failed ⚠");
            try { URL.revokeObjectURL(blobUrl); } catch (_) {}
          };

          imgEl.src = blobUrl;
        } else {
          // VIDEO preview marker
          clearFrameMedia(frame);
          frame.scene = scene;
          frame.mediaKind = "video";
          frame.fullUrl = blobUrl;
          attachVideoMarker(scene, frame);
          logDbg("Video marker ✔");
        }
      } catch (e) {
        console.warn("[RageCity] Blob preview failed:", e);
        logDbg("Blob preview failed ⚠");
      }

      // Fire Supabase upload in the background
      (async () => {
        try {
          logDbg("Uploading to Supabase…");
          const signedUrl = await uploadPaintingToSupabase(frameIndex, file);
          if (signedUrl) {
            if (frame.fullUrl && typeof frame.fullUrl === "string" && frame.fullUrl.startsWith("blob:")) {
              try { URL.revokeObjectURL(frame.fullUrl); } catch (_) {}
            }

            frame.fullUrl = signedUrl;
            frame.mimeType = file.type || frame.mimeType || "";
            logDbg("Supabase saved ✔");
            console.log("[RageCity] Frame updated with Supabase SIGNED URL", {
              frameIndex,
              signedUrl,
            });
          } else {
            logDbg("Supabase upload failed ⚠");
            console.warn("[RageCity] Supabase upload returned null for frame", frameIndex);
          }
        } finally {
          frame.locked = false;
          paintingUploadInput.value = "";
        }
      })();
    });
  }
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

function update(time, delta) {
  if (!player || !player.body) return;

  const justPressedA = inputState.A && !prevA;
  const justPressedB = inputState.B && !prevB;

  // Track X/Y edge transitions (but do nothing with them yet)
  // (we still update prevX/prevY at the end so presses don't "pile up")
  const _justPressedX = inputState.X && !prevX;
  const _justPressedY = inputState.Y && !prevY;

  // ✅ overlay open behavior: ONLY A fullscreen, ONLY B close
  if (window.artOpen) {
    if (justPressedA) window.toggleArtFullscreen();
    if (justPressedB) window.closeArtOverlay();

    prevA = inputState.A;
    prevB = inputState.B;
    prevX = inputState.X;
    prevY = inputState.Y;
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

  // find closest painting (track index so we know which one to edit)
  galleryFrames.forEach((f, index) => {
    const d = Phaser.Math.Distance.Between(player.x, player.y, f.x, f.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestItem = { type: "painting", index };
    }
  });

  // compare sculpture
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
        fullUrl: sculptureSpot.fullUrl,
        mimeType: ""
      };
    }
  }

  // prompt text
  if (promptText) {
    if (nearestItem && nearestDist < 80) {
      promptText.setVisible(true);
      if (nearestItem.type === "sculpture") {
        promptText.setText("Press A to inspect sculpture");
      } else {
        const frame = galleryFrames[nearestItem.index];
        const hasArt = frame && !!frame.fullUrl;
        if (hasArt) {
          // ✅ PATCH: use array text + bottom-anchor so both lines show
          promptText.setText(["Press A to view art", "Press B to replace art"]);
        } else {
          promptText.setText("Press A to add art");
        }
      }
    } else {
      promptText.setVisible(false);
    }
  }

  // A button (view or add)
  if (nearestItem && nearestDist < 60 && justPressedA) {
    if (nearestItem.type === "sculpture") {
      if (nearestItem.fullUrl) window.openArtOverlay({ url: nearestItem.fullUrl, mimeType: nearestItem.mimeType || "" });
    } else {
      currentPaintingIndex = nearestItem.index;
      const frame = galleryFrames[currentPaintingIndex];
      if (!frame) return;

      if (!frame.fullUrl) {
        console.log("[RageCity] Opening file picker for frame", currentPaintingIndex);
        if (paintingUploadInput) paintingUploadInput.click();
      } else {
        console.log("[RageCity] Opening overlay for existing art on frame", currentPaintingIndex);
        window.openArtOverlay({ url: frame.fullUrl, mimeType: frame.mimeType || "" });
      }
    }
  }

  // B button (replace art if it exists)
  if (
    nearestItem &&
    nearestItem.type === "painting" &&
    nearestDist < 60 &&
    justPressedB
  ) {
    const frameIndex = nearestItem.index;
    const frame = galleryFrames[frameIndex];
    if (frame && frame.fullUrl && paintingUploadInput) {
      currentPaintingIndex = frameIndex;
      console.log("[RageCity] Opening file picker to REPLACE art on frame", frameIndex);
      paintingUploadInput.click();
    }
  }

  prevA = inputState.A;
  prevB = inputState.B;
  prevX = inputState.X;
  prevY = inputState.Y;
}