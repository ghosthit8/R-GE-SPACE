let player;
let promptText;
let galleryFrames = [];
let sculptureSpot = null;
let wallsGroup;
let prevA = false;
let prevB = false;

// For per-painting uploads
let paintingUploadInput = null;
let currentPaintingIndex = null;

// --- Supabase shared gallery config ---
const GALLERY_BUCKET = "ragecity-gallery";
const PAINTINGS_TABLE = "ragecity_paintings";

// Extract the relative storage path (e.g. "paintings/painting_0_123.png")
// from a public URL that includes ".../storage/v1/object/public/<bucket>/".
function getPathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${GALLERY_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.substring(idx + marker.length);
}

// Load all painting URLs from Supabase and apply to frames
async function loadPaintingsFromSupabase(scene, imgDisplaySize) {
  if (!window.supabase) {
    console.warn(
      "[RageCity] Supabase client missing; skipping shared gallery load."
    );
    return;
  }

  try {
    const { data, error } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("frame_index, image_url");

    if (error) {
      console.error(
        "[RageCity] Error loading paintings from Supabase:",
        error
      );
      return;
    }

    if (!data || data.length === 0) return;

    data.forEach((row) => {
      const idx = row.frame_index;
      const frame = galleryFrames[idx];
      if (!frame) return;

      frame.fullUrl = row.image_url;

      const texKey = `supPainting-${idx}`;
      if (!scene.textures.exists(texKey)) {
        scene.load.image(texKey, row.image_url);
      }
    });

    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      data.forEach((row) => {
        const idx = row.frame_index;
        const frame = galleryFrames[idx];
        if (!frame) return;
        const texKey = `supPainting-${idx}`;
        if (!scene.textures.exists(texKey)) return;

        if (frame.img) {
          frame.img.destroy();
        }

        const img = scene.add.image(frame.x, frame.y, texKey);
        img.setDisplaySize(imgDisplaySize, imgDisplaySize);
        frame.img = img;
      });
    });

    scene.load.start();
  } catch (err) {
    console.error("[RageCity] Unexpected error loading paintings:", err);
  }
}

// Upload a file to Supabase bucket + upsert DB row, return public URL.
// If oldPath is provided, we will delete that object from the bucket
// after the new upload + DB upsert succeed.
async function uploadPaintingToSupabase(frameIndex, file, oldPath) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase client missing; cannot upload.");
    return null;
  }

  try {
    const ext = (file.type && file.type.split("/")[1]) || "png";
    // Use a timestamp in the filename so each upload is a fresh object.
    const timestamp = Date.now();
    const fileName = `painting_${frameIndex}_${timestamp}.${ext}`;
    const filePath = `paintings/${fileName}`;

    const { error: uploadError } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      console.error(
        "[RageCity] Error uploading painting to bucket:",
        uploadError
      );
      return null;
    }

    const { data: publicData } = window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = publicData && publicData.publicUrl;
    if (!publicUrl) {
      console.error(
        "[RageCity] Could not get public URL for painting"
      );
      return null;
    }

    const { error: upsertError } = await window.supabase
      .from(PAINTINGS_TABLE)
      .upsert(
        { frame_index: frameIndex, image_url: publicUrl },
        { onConflict: "frame_index" }
      );

    if (upsertError) {
      console.error(
        "[RageCity] Error upserting painting record:",
        upsertError
      );
      // still return publicUrl so the current user sees it
    }

    // If we had an older object path, delete it now to clean up the bucket.
    if (oldPath) {
      const { error: deleteError } = await window.supabase
        .storage
        .from(GALLERY_BUCKET)
        .remove([oldPath]);
      if (deleteError) {
        console.warn(
          "[RageCity] Failed to delete old painting object:",
          deleteError
        );
      }
    }

    return publicUrl;
  } catch (err) {
    console.error("[RageCity] Unexpected error uploading painting:", err);
    return null;
  }
}

function preload() {
  this.load.image("player", "assets/player.png");
}

function create() {
  const width = this.scale.width;
  const height = this.scale.height;

  const bg = this.add.rectangle(
    width / 2,
    height / 2,
    width,
    height,
    0x050714
  );
  bg.setOrigin(0.5);

  wallsGroup = this.physics.add.staticGroup();

  const marginSides = 60;
  const marginTop = 40;
  const marginBottom = 120;

  const leftOuter = marginSides;
  const rightOuter = width - marginSides;
  const topOuter = marginTop;
  const bottomOuter = height - marginBottom;

  const leftWall = this.add.rectangle(
    leftOuter,
    (topOuter + bottomOuter) / 2,
    4,
    bottomOuter - topOuter,
    0xffffff
  );
  const rightWall = this.add.rectangle(
    rightOuter,
    (topOuter + bottomOuter) / 2,
    4,
    bottomOuter - topOuter,
    0xffffff
  );
  const topWall = this.add.rectangle(
    (leftOuter + rightOuter) / 2,
    topOuter,
    rightOuter - leftOuter,
    4,
    0xffffff
  );
  const bottomWall = this.add.rectangle(
    (leftOuter + rightOuter) / 2,
    bottomOuter,
    rightOuter - leftOuter,
    4,
    0xffffff
  );

  wallsGroup.add(leftWall);
  wallsGroup.add(rightWall);
  wallsGroup.add(topWall);
  wallsGroup.add(bottomWall);

  const cornerOffset = 60;

  const topLeftDiag = this.add.line(
    leftOuter + cornerOffset,
    topOuter + cornerOffset,
    0,
    0,
    cornerOffset,
    -cornerOffset,
    0xffffff
  );
  const topRightDiag = this.add.line(
    rightOuter - cornerOffset,
    topOuter + cornerOffset,
    0,
    0,
    -cornerOffset,
    -cornerOffset,
    0xffffff
  );
  const bottomLeftDiag = this.add.line(
    leftOuter + cornerOffset,
    bottomOuter - cornerOffset,
    0,
    0,
    cornerOffset,
    cornerOffset,
    0xffffff
  );
  const bottomRightDiag = this.add.line(
    rightOuter - cornerOffset,
    bottomOuter - cornerOffset,
    0,
    0,
    -cornerOffset,
    cornerOffset,
    0xffffff
  );

  wallsGroup.add(topLeftDiag);
  wallsGroup.add(topRightDiag);
  wallsGroup.add(bottomLeftDiag);
  wallsGroup.add(bottomRightDiag);

  const leftInner = leftOuter + 60;
  const rightInner = rightOuter - 60;
  const topInner = topOuter + 60;
  const bottomInner = bottomOuter - 60;

  const leftInnerWall = this.add.rectangle(
    leftInner,
    (topInner + bottomInner) / 2,
    4,
    bottomInner - topInner,
    0xffffff
  );
  const rightInnerWall = this.add.rectangle(
    rightInner,
    (topInner + bottomInner) / 2,
    4,
    bottomInner - topInner,
    0xffffff
  );
  const topInnerWall = this.add.rectangle(
    (leftInner + rightInner) / 2,
    topInner,
    rightInner - leftInner,
    4,
    0xffffff
  );
  const bottomInnerWall = this.add.rectangle(
    (leftInner + rightInner) / 2,
    bottomInner,
    rightInner - leftInner,
    4,
    0xffffff
  );

  wallsGroup.add(leftInnerWall);
  wallsGroup.add(rightInnerWall);
  wallsGroup.add(topInnerWall);
  wallsGroup.add(bottomInnerWall);

  player = this.physics.add.rectangle(
    leftInner + 40,
    bottomInner - 80,
    18,
    18,
    0x39ff14
  );
  player.setOrigin(0.5);

  this.physics.add.existing(player);
  player.body.setCollideWorldBounds(true);

  this.physics.add.collider(player, wallsGroup);

  const addTrapezoidFrame = (scene, x, y, side) => {
    const outer = scene.add.graphics();
    outer.lineStyle(3, 0xffffff, 1);

    const wTop = 50;
    const wBottom = 50;
    const h = 40;

    let t1x, t1y, t2x, t2y, b1x, b1y, b2x, b2y;

    if (side === "top") {
      t1x = x - wTop / 2;
      t1y = y - h / 2;
      t2x = x + wTop / 2;
      t2y = y - h / 2;
      b1x = x - wBottom / 2;
      b1y = y + h / 2;
      b2x = x + wBottom / 2;
      b2y = y + h / 2;
    } else if (side === "bottom") {
      t1x = x - wTop / 2;
      t1y = y + h / 2;
      t2x = x + wTop / 2;
      t2y = y + h / 2;
      b1x = x - wBottom / 2;
      b1y = y - h / 2;
      b2x = x + wBottom / 2;
      b2y = y - h / 2;
    } else if (side === "left") {
      t1x = x - wTop / 2;
      t1y = y - h / 2;
      t2x = x + wTop / 2;
      t2y = y - h / 2;
      b1x = x - wBottom / 2;
      b1y = y + h / 2;
      b2x = x + wBottom / 2;
      b2y = y + h / 2;
    } else {
      t1x = x - wTop / 2;
      t1y = y - h / 2;
      t2x = x + wTop / 2;
      t2y = y - h / 2;
      b1x = x - wBottom / 2;
      b1y = y + h / 2;
      b2x = x + wBottom / 2;
      b2y = y + h / 2;
    }

    outer.moveTo(t1x, t1y);
    outer.lineTo(t2x, t2y);
    outer.lineTo(b2x, b2y);
    outer.lineTo(b1x, b1y);
    outer.closePath();
    outer.strokePath();

    const inner = scene.add.graphics();
    inner.lineStyle(3, 0x39ff14, 1);

    const inset = 6;
    const it1x = t1x + inset;
    const it1y = t1y + inset;
    const it2x = t2x - inset;
    const it2y = t2y + inset;
    const ib1x = b1x + inset;
    const ib1y = b1y - inset;
    const ib2x = b2x - inset;
    const ib2y = b2y - inset;

    inner.moveTo(it1x, it1y);
    inner.lineTo(it2x, it2y);
    inner.lineTo(ib2x, ib2y);
    inner.lineTo(ib1x, ib1y);
    inner.closePath();
    inner.strokePath();

    const frameIndex = galleryFrames.length;
    galleryFrames.push({
      x,
      y,
      side,
      outer,
      inner,
      img: null,
      frameIndex,
      fullUrl: null
    });
  };

  const imgDisplaySize = 40;

  const gapInnerTopY = topInner + 20;
  const gapInnerBottomY = bottomInner - 20;
  const gapInnerLeftX = leftInner + 20;
  const gapInnerRightX = rightInner - 20;

  const topPositions = [
    gapInnerLeftX + 24,
    gapInnerLeftX + 90,
    (gapInnerLeftX + gapInnerRightX) / 2,
    gapInnerRightX - 90,
    gapInnerRightX - 24
  ];
  topPositions.forEach((x) => {
    addTrapezoidFrame(this, x, topInner, "top");
  });

  const rightPositions = [
    gapInnerTopY + 24,
    gapInnerTopY + 90,
    (gapInnerTopY + gapInnerBottomY) / 2,
    gapInnerBottomY - 90,
    gapInnerBottomY - 24
  ];
  rightPositions.forEach((y) => {
    addTrapezoidFrame(this, rightInner, y, "right");
  });

  const leftYPositions = [
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

  const midLeftX = leftInner;
  const midBottomY = bottomInner;

  // ===== SCULPTURE CUBE =====
  const centerX = (leftOuter + rightOuter) / 2;
  const centerY = (topOuter + bottomOuter) / 2;
  const sculptureX = centerX + 35;
  const sculptureY = centerY + 60;

  const cube = this.add.graphics();
  cube.lineStyle(3, 0xffffff, 1);

  const size = 46; // outer front square
  const depth = 10;

  const frontX = sculptureX - size / 2;
  const frontY = sculptureY - size / 2;
  cube.strokeRect(frontX, frontY, size, size);

  const backX = frontX - depth;
  const backY = frontY - depth;
  cube.strokeRect(backX, backY, size, size);

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

  sculptureSpot = { x: sculptureX, y: sculptureY, fullUrl: null };

  const textY = height - 40;
  promptText = this.add.text(width / 2, textY, "", {
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

  setupKeyboard(this);
  setupTouchButton("btn-left", "left");
  setupTouchButton("btn-right", "right");
  setupTouchButton("btn-up", "up");
  setupTouchButton("btn-down", "down");
  setupTouchButton("btn-A", "A");
  setupTouchButton("btn-B", "B");

  setupFullscreenButton();

  loadPaintingsFromSupabase(this, imgDisplaySize);

  paintingUploadInput = document.getElementById("paintingUpload");
  if (paintingUploadInput) {
    paintingUploadInput.addEventListener("change", function () {
      const file = this.files && this.files[0];
      if (!file || currentPaintingIndex === null) {
        this.value = "";
        return;
      }

      const frameIndex = currentPaintingIndex;
      const frame = galleryFrames[frameIndex];
      if (!frame) {
        this.value = "";
        return;
      }

      // 1) Show thumbnail immediately using FileReader (local)
      const oldPath = getPathFromPublicUrl(frame.fullUrl);
      const reader = new FileReader();
      reader.onload = function (ev) {
        const dataUrl = ev.target.result;
        const texKeyLocal = `localPainting-${frameIndex}`;

        if (scene.textures.exists(texKeyLocal)) {
          scene.textures.remove(texKeyLocal);
        }

        scene.textures.addBase64(texKeyLocal, dataUrl);

        if (frame.img) {
          frame.img.destroy();
        }

        const img = scene.add.image(frame.x, frame.y, texKeyLocal);
        img.setDisplaySize(imgDisplaySize, imgDisplaySize);
        frame.img = img;

        // Local fallback URL (in case Supabase fails)
        frame.fullUrl = dataUrl;

        // 2) Fire Supabase upload in the background
        (async () => {
          const publicUrl = await uploadPaintingToSupabase(
            frameIndex,
            file,
            oldPath
          );
          if (publicUrl) {
            frame.fullUrl = publicUrl;
          }
        })();
      };

      reader.readAsDataURL(file);
      this.value = "";
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
}

const inputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  A: false,
  B: false
};

function setupKeyboard(scene) {
  scene.input.keyboard.on("keydown", (event) => {
    if (event.code === "ArrowLeft") inputState.left = true;
    if (event.code === "ArrowRight") inputState.right = true;
    if (event.code === "ArrowUp") inputState.up = true;
    if (event.code === "ArrowDown") inputState.down = true;
    if (event.code === "KeyZ") inputState.A = true;
    if (event.code === "KeyX") inputState.B = true;
  });

  scene.input.keyboard.on("keyup", (event) => {
    if (event.code === "ArrowLeft") inputState.left = false;
    if (event.code === "ArrowRight") inputState.right = false;
    if (event.code === "ArrowUp") inputState.up = false;
    if (event.code === "ArrowDown") inputState.down = false;
    if (event.code === "KeyZ") inputState.A = false;
    if (event.code === "KeyX") inputState.B = false;
  });
}

function setupTouchButton(id, direction) {
  const btn = document.getElementById(id);
  if (!btn) return;

  const setState = (value) => {
    inputState[direction] = value;
  };

  btn.addEventListener("touchstart", (event) => {
    event.preventDefault();
    setState(true);
  });

  btn.addEventListener("touchend", (event) => {
    event.preventDefault();
    setState(false);
  });

  btn.addEventListener("mousedown", () => {
    setState(true);
  });

  btn.addEventListener("mouseup", () => {
    setState(false);
  });

  btn.addEventListener("mouseleave", () => {
    setState(false);
  });
}

let artOpen = false;

function openArtOverlay(url) {
  const overlay = document.getElementById("art-overlay");
  const img = document.getElementById("art-overlay-img");
  if (!overlay || !img) return;

  img.src = url;
  overlay.style.display = "flex";
  artOpen = true;
}

function closeArtOverlay() {
  const overlay = document.getElementById("art-overlay");
  const img = document.getElementById("art-overlay-img");
  if (!overlay || !img) return;

  img.src = "";
  overlay.style.display = "none";
  artOpen = false;
}

function toggleArtFullscreen() {
  const img = document.getElementById("art-overlay-img");
  if (!img) return;

  if (!document.fullscreenElement) {
    if (img.requestFullscreen) {
      img.requestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
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

  if (vx !== 0 || vy !== 0) {
    const len = Math.sqrt(vx * vx + vy * vy);
    vx = (vx / len) * speed;
    vy = (vy / len) * speed;
  }

  player.body.setVelocity(vx, vy);

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
          promptText.setText(
            "Press A to view art\nPress B to replace art"
          );
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

  if (nearestItem && nearestItem.type === "painting" && nearestDist < 60) {
    if (justPressedB) {
      currentPaintingIndex = nearestItem.index;
      const frame = galleryFrames[currentPaintingIndex];
      if (!frame) return;

      if (paintingUploadInput) paintingUploadInput.click();
    }
  }

  prevA = inputState.A;
  prevB = inputState.B;
}