let player;
let promptText;
let galleryFrames = [];
let sculptureSpot = null;
let wallsGroup;
let prevA = false;
let prevB = false;

// NEW: for per-painting uploads
let paintingUploadInput = null;
let currentPaintingIndex = null;

// --- Painting persistence helpers (Supabase shared gallery) ---
//  We store one row per frame in the `ragecity_paintings` table
//  and the actual image file in the `ragecity-gallery` bucket.

const GALLERY_BUCKET = "ragecity-gallery";
const PAINTINGS_TABLE = "ragecity_paintings";

// Extract the storage path from a public URL so we can delete/replace files.
function getPathFromPublicUrl(url) {
  if (!url) return null;
  try {
    const marker = "/storage/v1/object/public/" + GALLERY_BUCKET + "/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  } catch (e) {
    console.warn("getPathFromPublicUrl failed", e);
    return null;
  }
}

// Load any existing paintings for this room from Supabase.
async function loadPaintingsFromSupabase(scene, imgDisplaySize) {
  const client = window.supabase;
  if (!client) {
    console.warn("Supabase client not found on window");
    return;
  }

  try {
    const { data, error } = await client
      .from(PAINTINGS_TABLE)
      .select("frame_index, image_url");

    if (error) {
      console.error("Error loading paintings", error);
      return;
    }

    (data || []).forEach((row) => {
      const index = row.frame_index;
      const url = row.image_url;
      const frame = galleryFrames[index];
      if (!frame || !url) return;

      const texKey = `userPainting-${index}`;

      if (scene.textures.exists(texKey)) {
        scene.textures.remove(texKey);
      }

      scene.load.image(texKey, url);
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        const img = scene.add.image(frame.x, frame.y, texKey);
        img.setDisplaySize(imgDisplaySize, imgDisplaySize);
        frame.img = img;
        frame.fullUrl = url;
      });
      scene.load.start();
    });
  } catch (err) {
    console.error("loadPaintingsFromSupabase error", err);
  }
}

// Upload a new painting file for a given frame. Optionally delete the old file.
async function uploadPaintingToSupabase(frameIndex, file, oldPath) {
  const client = window.supabase;
  if (!client) {
    console.warn("Supabase client not found on window");
    return null;
  }

  try {
    const ext = file.name.split(".").pop() || "png";
    const filePath = `paintings/painting_${frameIndex}_${Date.now()}.${ext}`;

    // Upload file
    const { error: uploadError } = await client.storage
      .from(GALLERY_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error", uploadError);
      alert("RageCity upload error: " + uploadError.message);
      return null;
    }

    // Get public URL
    const { data: pub } = client.storage.from(GALLERY_BUCKET).getPublicUrl(filePath);
    const publicUrl = pub.publicUrl;

    // Upsert DB row for this frame
    const { error: dbError } = await client
      .from(PAINTINGS_TABLE)
      .upsert(
        { frame_index: frameIndex, image_url: publicUrl },
        { onConflict: "frame_index" }
      );

    if (dbError) {
      console.error("DB upsert error", dbError);
    }

    // Delete old file if we know its path
    if (oldPath) {
      const { error: delError } = await client.storage
        .from(GALLERY_BUCKET)
        .remove([oldPath]);
      if (delError) {
        console.warn("Failed to delete old painting file", delError);
      }
    }

    return publicUrl;
  } catch (err) {
    console.error("uploadPaintingToSupabase error", err);
    alert("RageCity upload error (Storage): " + err.message);
    return null;
  }
}

function preload() {
  // You can leave this or remove it; it's no longer used for the frames.
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

  function addWallRect(x1, y1, x2, y2, thickness = 14) {
    if (x1 === x2 && y1 === y2) return;

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

  const doorWidth = 70;
  const doorCenterX = leftOuter + (rightOuter - leftOuter) * 0.12;
  const gapOuterLeftX = doorCenterX - doorWidth / 2;
  const gapOuterRightX = doorCenterX + doorWidth / 2;

  const gapInnerLeftX = doorCenterX - doorWidth / 2;
  const gapInnerRightX = doorCenterX + doorWidth / 2;

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
  wallOuter.closePath();
  wallOuter.strokePath();

  wallOuter.beginPath();
  wallOuter.moveTo(leftOuter, gapOuterTopY);
  wallOuter.lineTo(leftOuter, topOuter);
  wallOuter.moveTo(leftOuter, bottomOuter);
  wallOuter.lineTo(leftOuter, gapOuterBotY);
  wallOuter.strokePath();

  // Inner wall
  const wallInner = this.add.graphics();
  wallInner.lineStyle(4, 0xffffff, 1);
  wallInner.beginPath();
  wallInner.moveTo(leftInner, topInner);
  wallInner.lineTo(rightInner, topInner);
  wallInner.lineTo(rightInner, bottomInner);
  wallInner.lineTo(leftInner, bottomInner);
  wallInner.closePath();
  wallInner.strokePath();

  wallInner.beginPath();
  wallInner.moveTo(leftInner, gapInnerTopY);
  wallInner.lineTo(leftInner, topInner);
  wallInner.moveTo(leftInner, bottomInner);
  wallInner.lineTo(leftInner, gapInnerBotY);
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

  const wallThickness = 14;
  addWallRect(leftOuter, topOuter, rightOuter, topOuter, wallThickness);
  addWallRect(rightOuter, topOuter, rightOuter, bottomOuter, wallThickness);
  addWallRect(leftOuter, bottomOuter, rightOuter, bottomOuter, wallThickness);

  addWallRect(leftOuter, topOuter, leftOuter, gapOuterTopY, wallThickness);
  addWallRect(leftOuter, gapOuterBotY, leftOuter, bottomOuter, wallThickness);

  addWallRect(leftInner, topInner, rightInner, topInner, wallThickness);
  addWallRect(rightInner, topInner, rightInner, bottomInner, wallThickness);
  addWallRect(leftInner, bottomInner, rightInner, bottomInner, wallThickness);

  addWallRect(leftInner, topInner, leftInner, gapInnerTopY, wallThickness);
  addWallRect(leftInner, gapInnerBotY, leftInner, bottomInner, wallThickness);

  const nudge = 2;
  addWallBlock(leftInner - nudge, topInner + nudge, 18);
  addWallBlock(rightInner + nudge, topInner + nudge, 18);
  addWallBlock(rightInner + nudge, bottomInner - nudge, 18);
  addWallBlock(leftInner - nudge, bottomInner - nudge, 18);

  const hallwayWidth = doorWidth * 0.7;
  const halfHall = hallwayWidth / 2;
  const hallwayLeftX = doorCenterX - halfHall;
  const hallwayRightX = doorCenterX + halfHall;

  addWallRect(hallwayLeftX, topOuter, hallwayRightX, topOuter, wallThickness);
  addWallRect(hallwayLeftX, topOuter, hallwayLeftX, topInner, wallThickness);
  addWallRect(hallwayRightX, topOuter, hallwayRightX, topInner, wallThickness);

  const sideBoxWidth = 60;
  const sideBoxHeight = bottomOuter - topOuter - 60;
  const sideBoxLeft = leftInner;
  const sideBoxRight = sideBoxLeft + sideBoxWidth;
  const sideBoxTop = topOuter + 30;
  const sideBoxBottom = sideBoxTop + sideBoxHeight;

  const sideBox = this.add.graphics();
  sideBox.lineStyle(4, 0xffffff, 1);
  sideBox.strokeRect(
    sideBoxLeft,
    sideBoxTop,
    sideBoxWidth,
    sideBoxHeight
  );

  addWallRect(sideBoxLeft, sideBoxTop, sideBoxRight, sideBoxTop, wallThickness);
  addWallRect(sideBoxRight, sideBoxTop, sideBoxRight, sideBoxBottom, wallThickness);
  addWallRect(
    sideBoxLeft,
    sideBoxBottom,
    sideBoxRight,
    sideBoxBottom,
    wallThickness
  );
  addWallRect(sideBoxLeft, sideBoxTop, sideBoxLeft, sideBoxBottom, wallThickness);

  const openingHeight = 60;
  const openingCenterY = sideBoxTop + sideBoxHeight * 0.58;
  const openingTopY = openingCenterY - openingHeight / 2;
  const openingBottomY = openingCenterY + openingHeight / 2;

  sideBox.clear();
  sideBox.lineStyle(4, 0xffffff, 1);

  sideBox.strokeRect(
    sideBoxLeft,
    sideBoxTop,
    sideBoxWidth,
    openingTopY - sideBoxTop
  );

  sideBox.strokeRect(
    sideBoxLeft,
    openingBottomY,
    sideBoxWidth,
    sideBoxBottom - openingBottomY
  );

  sideBox.strokeLineShape(
    new Phaser.Geom.Line(sideBoxLeft, sideBoxTop, sideBoxLeft, sideBoxBottom)
  );
  sideBox.strokeLineShape(
    new Phaser.Geom.Line(sideBoxRight, sideBoxTop, sideBoxRight, sideBoxBottom)
  );

  const margin = 4;
  const boxLeftInner = sideBoxLeft + margin;
  const boxRightInner = sideBoxRight - margin;
  const boxTopInner = sideBoxTop + margin;
  const boxBottomInner = sideBoxBottom - margin;

  const dividerX1 = boxLeftInner + (boxRightInner - boxLeftInner) / 2;
  sideBox.strokeLineShape(
    new Phaser.Geom.Line(dividerX1, boxTopInner, dividerX1, boxTopInner + 70)
  );

  const dividerY1 = boxBottomInner - (boxBottomInner - boxTopInner) * 0.5;
  sideBox.strokeLineShape(
    new Phaser.Geom.Line(
      boxLeftInner,
      dividerY1,
      boxRightInner,
      dividerY1
    )
  );

  addWallRect(
    sideBoxLeft,
    sideBoxTop,
    sideBoxRight,
    sideBoxTop,
    wallThickness
  );
  addWallRect(
    sideBoxRight,
    sideBoxTop,
    sideBoxRight,
    sideBoxBottom,
    wallThickness
  );
  addWallRect(
    sideBoxLeft,
    sideBoxBottom,
    sideBoxRight,
    sideBoxBottom,
    wallThickness
  );
  addWallRect(
    sideBoxLeft,
    sideBoxTop,
    sideBoxLeft,
    sideBoxBottom,
    wallThickness
  );

  const doorNudge = 4;
  addWallRect(
    sideBoxLeft + doorNudge,
    sideBoxTop,
    sideBoxLeft + doorNudge,
    openingTopY,
    wallThickness
  );
  addWallRect(
    sideBoxLeft + doorNudge,
    openingBottomY,
    sideBoxLeft + doorNudge,
    sideBoxBottom,
    wallThickness
  );

  const wallThicknessMid = 14;
  const midY = topOuter + (bottomOuter - topOuter) / 2;
  const midGap = 68;
  const midLeftX = (leftInner + rightInner) / 2 - midGap / 2;
  const midRightX = (leftInner + rightInner) / 2 + midGap / 2;

  const midGraphics = this.add.graphics();
  midGraphics.lineStyle(4, 0xffffff, 1);
  midGraphics.beginPath();
  midGraphics.moveTo(midLeftX, midY);
  midGraphics.lineTo(midRightX, midY);
  midGraphics.strokePath();

  addWallRect(midLeftX, midY, midRightX, midY, wallThicknessMid);

  const midGapHalf = midGap / 2;
  const midLeftX2 = midLeftX - midGapHalf;
  const midRightX2 = midRightX + midGapHalf;

  addWallRect(
    midLeftX2,
    midY,
    midLeftX,
    midY,
    wallThicknessMid
  );
  addWallRect(
    midRightX,
    midY,
    midRightX2,
    midY,
    wallThicknessMid
  );

  const midY2 = midY + 14;
  addWallRect(midLeftX, midY2, midRightX, midY2, wallThicknessMid);

  const midAngle = this.add.graphics();
  midAngle.lineStyle(4, 0xffffff, 1);
  midAngle.beginPath();
  midAngle.moveTo(midLeftX2, midY);
  midAngle.lineTo(midLeftX, midY2);
  midAngle.moveTo(midRightX2, midY);
  midAngle.lineTo(midRightX, midY2);
  midAngle.strokePath();

  const midGapVertical = 140;
  const midTopY = midY - midGapVertical / 2;
  const midBottomY = midY + midGapVertical / 2;

  const midVerticalGraphics = this.add.graphics();
  midVerticalGraphics.lineStyle(4, 0xffffff, 1);
  midVerticalGraphics.beginPath();
  midVerticalGraphics.moveTo(midLeftX, midTopY);
  midVerticalGraphics.lineTo(midLeftX, midBottomY);
  midVerticalGraphics.moveTo(midRightX, midTopY);
  midVerticalGraphics.lineTo(midRightX, midBottomY);
  midVerticalGraphics.strokePath();

  addWallRect(
    midLeftX,
    midTopY,
    midLeftX,
    midBottomY,
    wallThicknessMid
  );
  addWallRect(
    midRightX,
    midTopY,
    midRightX,
    midBottomY,
    wallThicknessMid
  );

  const rightBoxWidth = sideBoxWidth;
  const rightBoxLeft = rightInner - rightBoxWidth;
  const rightBoxRight = rightInner;
  const rightBoxTop = topOuter + 30;
  const rightBoxBottom = rightBoxTop + sideBoxHeight;

  const rightBox = this.add.graphics();
  rightBox.lineStyle(4, 0xffffff, 1);
  rightBox.strokeRect(
    rightBoxLeft,
    rightBoxTop,
    rightBoxWidth,
    sideBoxHeight
  );

  const rightBoxMargin = margin;
  const rightBoxLeftInner = rightBoxLeft + rightBoxMargin;
  const rightBoxRightInner = rightBoxRight - rightBoxMargin;
  const rightBoxTopInner = rightBoxTop + rightBoxMargin;
  const rightBoxBottomInner = rightBoxBottom - rightBoxMargin;

  const rightDividerX = rightBoxRightInner - (rightBoxRightInner - rightBoxLeftInner) / 2;
  rightBox.strokeLineShape(
    new Phaser.Geom.Line(
      rightDividerX,
      rightBoxTopInner,
      rightDividerX,
      rightBoxTopInner + 80
    )
  );

  const rightDividerY = rightBoxBottomInner - (rightBoxBottomInner - rightBoxTopInner) * 0.43;
  rightBox.strokeLineShape(
    new Phaser.Geom.Line(
      rightBoxLeftInner,
      rightDividerY,
      rightBoxRightInner,
      rightDividerY
    )
  );

  addWallRect(
    rightBoxLeft,
    rightBoxTop,
    rightBoxRight,
    rightBoxTop,
    wallThickness
  );
  addWallRect(
    rightBoxRight,
    rightBoxTop,
    rightBoxRight,
    rightBoxBottom,
    wallThickness
  );
  addWallRect(
    rightBoxLeft,
    rightBoxBottom,
    rightBoxRight,
    rightBoxBottom,
    wallThickness
  );
  addWallRect(
    rightBoxLeft,
    rightBoxTop,
    rightBoxLeft,
    rightBoxBottom,
    wallThickness
  );

  const rightDoorNudge = 4;
  addWallRect(
    rightBoxRight - rightDoorNudge,
    rightBoxTop,
    rightBoxRight - rightDoorNudge,
    rightBoxTop + (rightBoxBottom - rightBoxTop) * 0.45,
    wallThickness
  );
  addWallRect(
    rightBoxRight - rightDoorNudge,
    rightBoxTop + (rightBoxBottom - rightBoxTop) * 0.64,
    rightBoxRight - rightDoorNudge,
    rightBoxBottom,
    wallThickness
  );

  // ===== NEON FRAMES (now start BLACK, no thumbnail art)
  const imgDisplaySize = 26; // how big user art thumbnails should be
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

    const img = null;

    galleryFrames.push({
      x,
      y,
      side,
      img,
      fullUrl: null
    });
  }

  const topPositions = [
    leftInner + 60,
    leftInner + 120,
    (leftInner + rightInner) / 2,
    rightInner - 120,
    rightInner - 60
  ];
  topPositions.forEach((x) => {
    addTrapezoidFrame(this, x, topInner + 18, "top");
  });

  const leftPositions = [
    topInner + 60,
    topInner + 120,
    (topInner + bottomInner) / 2,
    bottomInner - 120,
    bottomInner - 60
  ];
  leftPositions.forEach((y) => {
    addTrapezoidFrame(this, leftInner + 18, y, "left");
  });

  const rightPositions = [
    topInner + 60,
    topInner + 120,
    (topInner + bottomInner) / 2,
    bottomInner - 120,
    bottomInner - 60
  ];
  rightPositions.forEach((y) => {
    addTrapezoidFrame(this, rightInner - 18, y, "right");
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

  // 🔄 Load any saved art for these frames from Supabase
  loadPaintingsFromSupabase(this, imgDisplaySize);

  // ===== SCULPTURE CUBE =====
  const centerX = (leftOuter + rightOuter) / 2;
  const centerY = (topOuter + bottomOuter) / 2;
  const sculptureX = centerX + 35;
  const sculptureY = centerY + 60;

  const cube = this.add.graphics();
  cube.lineStyle(3, 0xffffff, 1);

  const size = 46;
  const depth = 10;

  const frontX = sculptureX - size / 2;
  const frontY = sculptureY - size / 2;
  cube.strokeRect(frontX, frontY, size, size);

  const backX = frontX - depth;
  const backY = frontY - depth;
  cube.strokeRect(backX, backY, size, size);

  cube.strokeLineShape(new Phaser.Geom.Line(frontX, frontY, backX, backY));
  cube.strokeLineShape(
    new Phaser.Geom.Line(frontX + size, frontY, backX + size, backY)
  );
  cube.strokeLineShape(
    new Phaser.Geom.Line(
      frontX,
      frontY + size,
      backX,
      backY + size
    )
  );
  cube.strokeLineShape(
    new Phaser.Geom.Line(
      frontX + size,
      frontY + size,
      backX + size,
      backY + size
    )
  );

  const innerSize = 22;
  const inner = this.add.rectangle(
    sculptureX,
    sculptureY,
    innerSize,
    innerSize
  );
  inner.setStrokeStyle(3, 0x39ff14);
  inner.setFillStyle(0x000000, 1);

  sculptureSpot = {
    x: sculptureX,
    y: sculptureY,
    fullUrl:
      "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1000&q=80"
  };

  this.physics.add.existing(inner, true);
  wallsGroup.add(inner);

  const playerSize = 16;
  player = this.physics.add
    .image(leftInner + 45, bottomInner - 45, null)
    .setOrigin(0.5, 0.5);
  player.displayWidth = playerSize;
  player.displayHeight = playerSize;
  player.setTint(0x39ff14);

  player.body.setCollideWorldBounds(true);
  this.physics.add.collider(player, wallsGroup);

  promptText = this.add.text(w / 2, bottomOuter + 40, "", {
    fontFamily: "Orbitron, system-ui, sans-serif",
    fontSize: "18px",
    color: "#39ff14",
    align: "center"
  });
  promptText.setOrigin(0.5, 0.5);
  promptText.setShadow(0, 0, "#000", 8, true, true);
  promptText.setVisible(false);

  setupKeyboardInput(this);
  setupTouchButton("btn-left", "left");
  setupTouchButton("btn-right", "right");
  setupTouchButton("btn-up", "up");
  setupTouchButton("btn-down", "down");
  setupTouchButton("btn-a", "A");
  setupTouchButton("btn-b", "B");
  setupFullscreenButton();

  const artOverlayEl = document.getElementById("art-overlay");
  if (artOverlayEl) {
    artOverlayEl.addEventListener("click", () => {
      if (artOpen) closeArtOverlay();
    });
  }

  // ====== hook the hidden <input type="file" id="paintingUpload"> ======
  paintingUploadInput = document.getElementById("paintingUpload");
  if (paintingUploadInput) {
    paintingUploadInput.addEventListener("change", function (e) {
      const file = this.files && this.files[0];
      if (!file || currentPaintingIndex === null) return;

      const frameIndex = currentPaintingIndex;
      const frame = galleryFrames[frameIndex];
      if (!frame) return;

      const oldPath = getPathFromPublicUrl(frame.fullUrl);

      // Local preview while upload happens
      const reader = new FileReader();
      reader.onload = function (ev) {
        const dataUrl = ev.target.result;
        const texKey = `userPainting-${frameIndex}`;

        if (scene.textures.exists(texKey)) {
          scene.textures.remove(texKey);
        }

        scene.textures.addBase64(texKey, dataUrl);

        if (frame.img) {
          frame.img.destroy();
        }

        const img = scene.add.image(frame.x, frame.y, texKey);
        img.setDisplaySize(imgDisplaySize, imgDisplaySize);
        frame.img = img;
      };
      reader.readAsDataURL(file);

      // Upload to Supabase, update frame.fullUrl, and delete old image if needed
      uploadPaintingToSupabase(frameIndex, file, oldPath)
        .then((publicUrl) => {
          if (publicUrl) {
            const f = galleryFrames[frameIndex];
            if (f) f.fullUrl = publicUrl;
          }
        })
        .catch((err) => {
          console.error("uploadPaintingToSupabase failed", err);
        })
        .finally(() => {
          // reset so same file can be chosen again if needed
          paintingUploadInput.value = "";
        });
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

  document.addEventListener("fullscreenchange", () => {});
}

const inputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  A: false,
  B: false
};

let artOpen = false;
let artFullscreen = false;

function openArtOverlay(url) {
  const overlay = document.getElementById("art-overlay");
  const img = document.getElementById("art-overlay-img");
  if (!overlay || !img) return;

  img.src = url;
  overlay.style.display = "flex";
  artOpen = true;
  artFullscreen = false;
  overlay.classList.remove("fullscreen");
}

function closeArtOverlay() {
  const overlay = document.getElementById("art-overlay");
  if (!overlay) return;

  overlay.style.display = "none";
  artOpen = false;
  artFullscreen = false;
  overlay.classList.remove("fullscreen");
}

function toggleArtFullscreen() {
  const overlay = document.getElementById("art-overlay");
  if (!overlay) return;

  artFullscreen = !artFullscreen;
  if (artFullscreen) {
    overlay.classList.add("fullscreen");
  } else {
    overlay.classList.remove("fullscreen");
  }
}

function setupKeyboardInput(scene) {
  const cursors = scene.input.keyboard.createCursorKeys();
  const keyA = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
  const keyB = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);

  scene.input.keyboard.on("keydown", (event) => {
    if (event.key === "ArrowLeft") inputState.left = true;
    if (event.key === "ArrowRight") inputState.right = true;
    if (event.key === "ArrowUp") inputState.up = true;
    if (event.key === "ArrowDown") inputState.down = true;
  });

  scene.input.keyboard.on("keyup", (event) => {
    if (event.key === "ArrowLeft") inputState.left = false;
    if (event.key === "ArrowRight") inputState.right = false;
    if (event.key === "ArrowUp") inputState.up = false;
    if (event.key === "ArrowDown") inputState.down = false;
  });

  scene.input.keyboard.on("keydown-A", () => {
    inputState.A = true;
  });
  scene.input.keyboard.on("keyup-A", () => {
    inputState.A = false;
  });

  scene.input.keyboard.on("keydown-B", () => {
    inputState.B = true;
  });
  scene.input.keyboard.on("keyup-B", () => {
    inputState.B = false;
  });
}

function setupTouchButton(buttonId, direction) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  function setState(value) {
    if (direction === "left") inputState.left = value;
    if (direction === "right") inputState.right = value;
    if (direction === "up") inputState.up = value;
    if (direction === "down") inputState.down = value;
    if (direction === "A") inputState.A = value;
    if (direction === "B") inputState.B = value;
  }

  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    setState(true);
  });

  btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    setState(false);
  });

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    setState(true);
  });
  btn.addEventListener("mouseup", (e) => {
    e.preventDefault();
    setState(false);
  });
  btn.addEventListener("mouseleave", (e) => {
    e.preventDefault();
    setState(false);
  });
}

function update(time, delta) {
  if (!player || !player.body) return;

  const justPressedA = inputState.A && !prevA;
  const justPressedB = inputState.B && !prevB;

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

  if (vx !== 0 && vy !== 0) {
    const inv = 1 / Math.sqrt(2);
    vx *= inv;
    vy *= inv;
  }

  player.setVelocity(vx * speed, vy * speed);

  let nearestItem = null;
  let nearestDist = Infinity;

  galleryFrames.forEach((f, index) => {
    const d = Phaser.Math.Distance.Between(player.x, player.y, f.x, f.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestItem = { type: "painting", index };
    }
  });

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

  if (promptText) {
    if (nearestItem && nearestDist < 80) {
      promptText.setVisible(true);
      if (nearestItem.type === "sculpture") {
        promptText.setText("Press A to inspect sculpture");
      } else {
        const frame = galleryFrames[nearestItem.index];
        const hasArt = frame && !!frame.fullUrl;
        if (hasArt) {
          promptText.setText("Press A to view art\nPress B to replace art");
        } else {
          promptText.setText("Press A to add art");
        }
      }
    } else {
      promptText.setVisible(false);
    }
  }

  if (nearestItem && nearestDist < 60 && justPressedA) {
    if (nearestItem.type === "sculpture") {
      if (nearestItem.fullUrl) openArtOverlay(nearestItem.fullUrl);
    } else {
      currentPaintingIndex = nearestItem.index;
      const frame = galleryFrames[currentPaintingIndex];
      if (!frame) return;

      if (!frame.fullUrl) {
        if (paintingUploadInput) paintingUploadInput.click();
      } else {
        openArtOverlay(frame.fullUrl);
      }
    }
  }

  // B near a painting = replace art (always opens the picker)
  if (nearestItem && nearestItem.type === "painting" && nearestDist < 60 && justPressedB) {
    currentPaintingIndex = nearestItem.index;
    const frame = galleryFrames[currentPaintingIndex];
    if (frame && paintingUploadInput) {
      paintingUploadInput.click();
    }
  }

  prevA = inputState.A;
  prevB = inputState.B;
}

const config = {
  type: Phaser.AUTO,
  width: 400,
  height: 600,
  parent: "game-container",
  backgroundColor: "#05060c",
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: {
    preload,
    create,
    update
  }
};

window.addEventListener("load", () => {
  new Phaser.Game(config);
});