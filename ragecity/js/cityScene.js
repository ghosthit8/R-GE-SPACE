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
  const w = this.scale.width;
  const h = this.scale.height;

  const marginX = 40;
  const marginY = 40;

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

  const graphics = this.add.graphics();
  graphics.lineStyle(6, 0x39ff14, 1);
  graphics.strokeRect(
    leftOuter,
    topOuter,
    rightOuter - leftOuter,
    bottomOuter - topOuter
  );

  graphics.lineStyle(6, 0xffffff, 1);
  graphics.strokeRect(
    leftInner,
    topInner,
    rightInner - leftInner,
    bottomInner - topInner
  );

  graphics.lineStyle(6, 0x39ff14, 1);
  graphics.beginPath();
  graphics.moveTo(leftOuter, bottomOuter);
  graphics.lineTo(leftInner, topInner);
  graphics.strokePath();

  const midY = (topInner + bottomInner) / 2;
  const ledgeOffsetY = 46;
  const ledgeShort = 90;
  const ledgeLong = 170;

  graphics.lineStyle(6, 0xffffff, 1);
  graphics.beginPath();
  graphics.moveTo(leftOuter, midY - ledgeOffsetY);
  graphics.lineTo(leftOuter + ledgeShort, midY - ledgeOffsetY);
  graphics.strokePath();

  graphics.beginPath();
  graphics.moveTo(leftOuter, midY + ledgeOffsetY);
  graphics.lineTo(leftOuter + ledgeLong, midY + ledgeOffsetY);
  graphics.strokePath();

  const centerX = (leftInner + rightInner) / 2;
  const centerY = (topInner + bottomInner) / 2;
  const sculptureSizeOuter = 170;
  const sculptureSizeInner = 140;

  graphics.lineStyle(6, 0xffffff, 1);
  graphics.strokeRect(
    centerX - sculptureSizeOuter / 2,
    centerY - sculptureSizeOuter / 2,
    sculptureSizeOuter,
    sculptureSizeOuter
  );

  graphics.lineStyle(6, 0x39ff14, 1);
  graphics.strokeRect(
    centerX - sculptureSizeInner / 2,
    centerY - sculptureSizeInner / 2,
    sculptureSizeInner,
    sculptureSizeInner
  );

  const frameSize = 70;
  const framePadding = 12;

  const framePositions = [
    { x: centerX, y: topInner - frameSize / 2 - 22, kind: "painting" },
    { x: leftInner - frameSize / 2 - 22, y: topInner + (bottomInner - topInner) / 4, kind: "painting" },
    { x: leftInner - frameSize / 2 - 22, y: topInner + (bottomInner - topInner) * 0.75, kind: "painting" },
    { x: centerX, y: bottomInner + frameSize / 2 + 22, kind: "painting" },
    { x: rightInner + frameSize / 2 + 22, y: topInner + (bottomInner - topInner) / 4, kind: "painting" },
    { x: rightInner + frameSize / 2 + 22, y: topInner + (bottomInner - topInner) * 0.75, kind: "painting" },
    { x: centerX, y: centerY, kind: "sculpture" }
  ];

  galleryFrames = [];
  sculptureSpot = null;

  framePositions.forEach((pos, idx) => {
    const frameGraphics = this.add.graphics();
    frameGraphics.lineStyle(4, 0x39ff14, 1);
    frameGraphics.strokeRect(
      pos.x - frameSize / 2,
      pos.y - frameSize / 2,
      frameSize,
      frameSize
    );

    const diag = this.add.graphics();
    diag.lineStyle(2, 0x39ff14, 1);
    diag.beginPath();
    diag.moveTo(pos.x - frameSize / 2, pos.y + frameSize / 2);
    diag.lineTo(pos.x + frameSize / 2, pos.y - frameSize / 2);
    diag.strokePath();

    const thumb = this.add
      .image(pos.x, pos.y, "artThumb")
      .setDisplaySize(frameSize - framePadding, frameSize - framePadding);

    const item = {
      id: idx,
      kind: pos.kind,
      sprite: thumb,
      fullUrl: pos.kind === "sculpture" ? SCULPTURE_FULL_URL : PAINTING_FULL_URL
    };

    galleryFrames.push(item);

    if (pos.kind === "sculpture") {
      sculptureSpot = item;
    }
  });

  player = this.physics.add
    .image(leftInner + 100, bottomInner - 50, "artThumb")
    .setDisplaySize(26, 26);

  player.setTint(0x39ff14);

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

  addWallRect(leftInner, topInner, rightInner, topInner);
  addWallRect(leftInner, bottomInner, rightInner, bottomInner);
  addWallRect(leftInner, topInner, leftInner, bottomInner);
  addWallRect(rightInner, topInner, rightInner, bottomInner);

  const sculptureColliderSize = 90;
  const sculptureCollider = scene.add.rectangle(
    centerX,
    centerY,
    sculptureColliderSize,
    sculptureColliderSize,
    0x00ff00,
    0
  );
  sculptureCollider.setVisible(false);
  scene.physics.add.existing(sculptureCollider, true);
  wallsGroup.add(sculptureCollider);

  const corridorOffsetY = 110;

  const bottomBlockLeftX = leftInner + 60;
  const bottomBlockRightX = rightInner - 60;

  addWallRect(bottomBlockLeftX, bottomInner, bottomBlockLeftX, bottomInner + 80);
  addWallRect(bottomBlockRightX, bottomInner, bottomBlockRightX, bottomInner + 80);

  this.physics.add.collider(player, wallsGroup);

  promptText = this.add
    .text(w / 2, bottomOuter + 20, "", {
      fontFamily: "monospace",
      fontSize: "20px",
      color: "#39ff14"
    })
    .setOrigin(0.5, 0)
    .setDepth(10);

  promptText.setVisible(false);

  window.galleryFrames = galleryFrames;

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

      const frame = galleryFrames.find((f) => f.id === frameIndex);
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

        frame.sprite.setTexture(texKey);
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
      closeAddArtMenu();
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

  const speed = 250;
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

  // Look for nearest frame/sculpture
  for (const item of galleryFrames) {
    const dx = item.sprite.x - player.x;
    const dy = item.sprite.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestItem = item;
    }
  }

  if (nearestItem && nearestDist < 90) {
    if (nearestItem.kind === "sculpture") {
      if (nearestItem.fullUrl) {
        promptText.setText("Press A to inspect sculpture");
      } else {
        promptText.setText("Press A to add sculpture art");
      }
    } else {
      if (nearestItem.fullUrl) {
        promptText.setText("Press A to view art");
      } else {
        promptText.setText("Press A to add art");
      }
    }
    promptText.setVisible(true);
  } else {
    promptText.setVisible(false);
  }

  if (nearestItem && nearestDist < 90 && justPressedA) {
    if (nearestItem.fullUrl) {
      openArtOverlay(nearestItem.fullUrl);
    } else {
      openAddArtMenu(nearestItem.id);
    }
  }

  prevA = inputState.A;
  prevB = inputState.B;
}