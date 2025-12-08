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
  const width = this.scale.width;
  const height = this.scale.height;

  // Center playable area
  const margin = 20;
  const playWidth = width - margin * 2;
  const playHeight = height - margin * 2;

  // Outer boundaries
  const leftOuter = margin;
  const rightOuter = margin + playWidth;
  const topOuter = margin;
  const bottomOuter = margin + playHeight;

  // Inner gallery room box
  const boxMargin = 60;
  const leftInner = leftOuter + boxMargin;
  const rightInner = rightOuter - boxMargin;
  const topInner = topOuter + boxMargin;
  const bottomInner = bottomOuter - boxMargin;

  // Create a group for walls so it's easier to debug collisions
  wallsGroup = this.physics.add.staticGroup();

  // Outer neon rectangle (visual only)
  const outerRect = this.add.graphics();
  outerRect.lineStyle(4, 0x00ff00, 1);
  outerRect.strokeRect(
    leftOuter,
    topOuter,
    rightOuter - leftOuter,
    bottomOuter - topOuter
  );

  // Inner neon rectangle
  const innerRect = this.add.graphics();
  innerRect.lineStyle(4, 0xffffff, 1);
  innerRect.strokeRect(
    leftInner,
    topInner,
    rightInner - leftInner,
    bottomInner - topInner
  );

  // Collider walls on inner box (we'll make small corridors later)
  const wallThickness = 4;

  function addWall(x, y, width, height, label) {
    const wall = wallsGroup.create(x + width / 2, y + height / 2, null);
    wall.body.setSize(width, height);
    wall.body.immovable = true;
    wall.label = label;
  }

  // Top inner
  addWall(leftInner, topInner, rightInner - leftInner, wallThickness, "top");
  // Bottom inner
  addWall(
    leftInner,
    bottomInner - wallThickness,
    rightInner - leftInner,
    wallThickness,
    "bottom"
  );
  // Left inner
  addWall(leftInner, topInner, wallThickness, bottomInner - topInner, "left");
  // Right inner
  addWall(
    rightInner - wallThickness,
    topInner,
    wallThickness,
    bottomInner - topInner,
    "right"
  );

  // Adding corridors for sculpture box
  const corridorWidth = 40;
  const corridorOffset = 80;

  // Top corridor
  addWall(
    leftInner + corridorOffset,
    topInner,
    corridorWidth,
    wallThickness,
    "topCorridor"
  );
  // Bottom corridor
  addWall(
    rightInner - corridorWidth - corridorOffset,
    bottomInner - wallThickness,
    corridorWidth,
    wallThickness,
    "bottomCorridor"
  );

  // Neon diagonal from top-left inner corner to bottom-left outer corner
  const diag = this.add.graphics();
  diag.lineStyle(4, 0x00ff00, 1);
  diag.beginPath();
  diag.moveTo(leftInner, topInner);
  diag.lineTo(leftOuter, bottomOuter);
  diag.strokePath();

  // Ledges
  const ledges = this.add.graphics();
  ledges.lineStyle(4, 0xffffff, 1);
  const ledgeLength = leftInner - leftOuter;
  const upperLedgeY = (topInner + bottomInner) / 2 - 40;
  const lowerLedgeY = (topInner + bottomInner) / 2 + 40;
  ledges.beginPath();
  ledges.moveTo(leftOuter, upperLedgeY);
  ledges.lineTo(leftOuter + ledgeLength, upperLedgeY);
  ledges.moveTo(leftOuter, lowerLedgeY);
  ledges.lineTo(leftOuter + ledgeLength, lowerLedgeY);
  ledges.strokePath();

  // Sculpture box in the middle
  const sculptureBox = this.add.graphics();
  sculptureBox.lineStyle(4, 0xffffff, 1);
  const sculptureSize = 120;
  const sculptureX = (leftInner + rightInner) / 2;
  const sculptureY = (topInner + bottomInner) / 2;
  const halfSize = sculptureSize / 2;
  sculptureBox.strokeRect(
    sculptureX - halfSize,
    sculptureY - halfSize,
    sculptureSize,
    sculptureSize
  );

  // Collider for sculpture box (only around the square we want)
  const sculptureColliderSize = 80;
  const sculptureColliderHalf = sculptureColliderSize / 2;
  const sculptureColliderX = sculptureX;
  const sculptureColliderY = sculptureY + 10; // Slightly lower
  addWall(
    sculptureColliderX - sculptureColliderHalf,
    sculptureColliderY - sculptureColliderHalf,
    sculptureColliderSize,
    sculptureColliderSize,
    "sculptureBox"
  );

  // Create frames and their hit areas
  galleryFrames = [];
  const frameSize = 80;
  const frameOffset = 20;

  // Helper to create a frame with a collider
  function createFrame(x, y, isPainting, frameIndex) {
    const frameRect = this.add.graphics();
    frameRect.lineStyle(4, 0xffffff, 1);
    frameRect.strokeRect(
      x - frameSize / 2,
      y - frameSize / 2,
      frameSize,
      frameSize
    );

    const img = this.add
      .image(x, y, "artThumb")
      .setDisplaySize(frameSize - frameOffset, frameSize - frameOffset);

    const frameCollider = wallsGroup.create(x, y, null);
    frameCollider.body.setSize(frameSize, frameSize);
    frameCollider.body.immovable = true;
    frameCollider.isFrame = true;
    frameCollider.frameIndex = frameIndex;
    frameCollider.isPainting = isPainting;

    const frameData = {
      frameIndex,
      img,
      isPainting,
      fullUrl: null
    };

    galleryFrames.push(frameData);

    if (!isPainting) {
      sculptureSpot = frameData;
    }
  }

  // Sculpture frame (center)
  createFrame.call(this, sculptureX, sculptureY, false, 0);

  // Paintings on the walls
  const paintingYTop = topInner + frameSize;
  const paintingYBottom = bottomInner - frameSize;
  const paintingXLeft = leftInner + frameSize;
  const paintingXRight = rightInner - frameSize;

  let frameIndex = 1;

  // Top row frames
  for (let i = 0; i < 3; i++) {
    const x = leftInner + (i + 1) * ((rightInner - leftInner) / 4);
    createFrame.call(this, x, paintingYTop, true, frameIndex++);
  }

  // Bottom row frames
  for (let i = 0; i < 3; i++) {
    const x = leftInner + (i + 1) * ((rightInner - leftInner) / 4);
    createFrame.call(this, x, paintingYBottom, true, frameIndex++);
  }

  // Left wall frames
  createFrame.call(this, paintingXLeft, (topInner + bottomInner) / 2, true, frameIndex++);

  // Right wall frames
  createFrame.call(this, paintingXRight, (topInner + bottomInner) / 2, true, frameIndex++);

  // Player
  player = this.physics.add
    .rectangle((leftInner + rightInner) / 2, bottomInner - 40, 20, 20, 0x00ff00)
    .setOrigin(0.5, 0.5);

  this.physics.add.collider(player, wallsGroup);

  // Prompt text
  promptText = this.add
    .text(width / 2, bottomOuter + 30, "", {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#00ff00",
      align: "center"
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setDepth(1000);

  promptText.setVisible(false);

  // Expose galleryFrames to window for overlay.js
  window.galleryFrames = galleryFrames;

  // Load existing art URLs from Supabase for each frame
  loadRageCityFramesFromSupabase();
}

async function loadRageCityFramesFromSupabase() {
  const supa = window.supabaseClient;
  if (!supa) {
    console.warn("Supabase client not configured for Rage City.");
    return;
  }

  try {
    const { data, error } = await supa
      .from("ragecity_frames")
      .select("frame_index, storage_path");

    if (error) {
      console.error("Error fetching Rage City frames:", error);
      return;
    }

    if (!data) return;

    const bucketName = "ragecity-art";

    for (const row of data) {
      const frameIndex = row.frame_index;
      const storagePath = row.storage_path;

      const frame = galleryFrames.find((f) => f.frameIndex === frameIndex);
      if (!frame) continue;

      const { data: pub } = supa.storage
        .from(bucketName)
        .getPublicUrl(storagePath);

      const publicUrl = pub?.publicUrl;
      if (!publicUrl) continue;

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        const texKey = "frame_upload_" + frameIndex;
        const game = Phaser.GAMES && Phaser.GAMES[0];

        if (game && game.textures) {
          if (game.textures.exists(texKey)) {
            game.textures.remove(texKey);
          }
          game.textures.addImage(texKey, img);
        }

        frame.img.setTexture(texKey);
        frame.fullUrl = publicUrl;
      };
      img.src = publicUrl;
    }
  } catch (err) {
    console.error("Unexpected error loading Rage City frames:", err);
  }
}

function update(time, delta) {
  if (!player || !player.body) return;

  const justPressedA = inputState.A && !prevA;
  const justPressedB = inputState.B && !prevB;

  // DEBUG: log button presses + overlay state when A/B is pressed
  if (justPressedA || justPressedB) {
    console.log("[RageCity INPUT] A/B press", {
      A: inputState.A,
      B: inputState.B,
      justPressedA,
      justPressedB,
      artOpen: window.artOpen,
      addArtOpen: window.addArtOpen
    });
  }

  // If the add-art menu is open:
  //  - A triggers the file picker
  //  - B closes the menu
  if (addArtOpen) {
    if (justPressedA) {
      if (typeof triggerAddArtFilePicker === "function") {
        triggerAddArtFilePicker();
      }
    } else if (justPressedB) {
      if (typeof closeAddArtMenu === "function") {
        closeAddArtMenu();
      }
    }

    prevA = inputState.A;
    prevB = inputState.B;
    return;
  }

  // If the art overlay is open:
  //  - A toggles fullscreen
  //  - B closes the overlay
  if (artOpen) {
    if (justPressedA) {
      if (typeof toggleArtFullscreen === "function") {
        toggleArtFullscreen();
      }
    } else if (justPressedB) {
      if (typeof closeArtOverlay === "function") {
        closeArtOverlay();
      }
    }

    prevA = inputState.A;
    prevB = inputState.B;
    return;
  }

  // Movement
  const speed = 200;
  let vx = 0;
  let vy = 0;

  if (inputState.left) vx -= speed;
  if (inputState.right) vx += speed;
  if (inputState.up) vy -= speed;
  if (inputState.down) vy += speed;

  player.body.setVelocity(vx, vy);
  player.body.velocity.normalize().scale(speed);

  // Find nearest frame/sculpture
  let nearestItem = null;
  let nearestDist = Infinity;

  const playerX = player.x;
  const playerY = player.y;

  for (const frame of galleryFrames) {
    const dx = frame.img.x - playerX;
    const dy = frame.img.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < nearestDist) {
      nearestDist = dist;
      nearestItem = frame;
    }
  }

  // Show prompt if close enough
  if (nearestItem && nearestDist < 60) {
    if (nearestItem.isPainting) {
      if (nearestItem.fullUrl) {
        promptText.setText("Press A to view art");
      } else {
        promptText.setText("Press A to add art");
      }
    } else {
      // sculpture
      if (nearestItem.fullUrl) {
        promptText.setText("Press A to inspect sculpture");
      } else {
        promptText.setText("Press A to add sculpture art");
      }
    }
    promptText.setVisible(true);
  } else {
    promptText.setVisible(false);
  }

  // Interaction when pressing A near something
  if (nearestItem && nearestDist < 60 && justPressedA) {
    if (!nearestItem.isPainting) {
      // Sculpture
      if (nearestItem.fullUrl) {
        openArtOverlay(nearestItem.fullUrl);
      } else {
        openAddArtMenu(nearestItem.frameIndex);
      }
    } else {
      // Painting
      if (nearestItem.fullUrl) {
        openArtOverlay(nearestItem.fullUrl);
      } else {
        openAddArtMenu(nearestItem.frameIndex);
      }
    }
  }

  prevA = inputState.A;
  prevB = inputState.B;
}