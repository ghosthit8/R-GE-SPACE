let player;
let promptText;
let galleryFrames = [];
let sculptureCollider;
let currentPaintingIndex = null;
let lastInteractionTime = 0;
const INTERACTION_COOLDOWN = 250;

let paintingUploadInput = null;
let isFullscreen = false;

const SUPABASE_URL = "https://tuqvpcevrhciursxrgav.supabase.co";
const GALLERY_BUCKET = "ragecity-gallery";
const PAINTINGS_TABLE = "ragecity_paintings";

// Log once when this file loads so we know it's the right version
console.log("[RageCity] CityScene.js loaded (shared gallery + Supabase v3)");

class CityScene extends Phaser.Scene {
  constructor() {
    super("CityScene");
  }

  preload() {
    console.log("[RageCity] CityScene preload() starting.");

    if (window.supabase && !window.supabase.storage) {
      console.warn(
        "[RageCity] Supabase client on window exists but .storage is missing – check client initialization."
      );
    }

    this.drawGalleryLayout();
  }

  create() {
    console.log("[RageCity] CityScene create() starting.");

    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;
    const margin = 40;

    const df = Math.min(screenWidth, screenHeight) * 0.045;

    player = this.add.rectangle(
      screenWidth / 2,
      screenHeight / 2 + 100,
      df,
      df,
      0x00ff00
    );

    this.physics.add.existing(player);
    player.body.setCollideWorldBounds(true);

    player.body.setSize(df, df, true);
    player.body.setOffset(0, 0);

    const lines = this.addLinesGeometry();
    this.physics.add.existing(lines, true);

    this.physics.add.collider(player, lines);

    sculptureCollider = this.add.rectangle(
      screenWidth / 2,
      screenHeight / 2 + 10,
      130,
      90
    );
    sculptureCollider.setOrigin(0.5, 0.5);
    sculptureCollider.rotation = 0;

    this.physics.add.existing(sculptureCollider, true);
    sculptureCollider.body.setSize(130, 90);
    sculptureCollider.body.setOffset(
      sculptureCollider.x - 65,
      sculptureCollider.y - 45
    );

    const overlayDiv = document.getElementById("rage-overlay");
    const messageText = overlayDiv
      ? overlayDiv.getAttribute("data-message")
      : "Press A to view art";

    promptText = this.add
      .text(screenWidth / 2, screenHeight - margin, messageText, {
        fontFamily: '"Orbitron", system-ui',
        fontSize: "26px",
        color: "#00ff00",
      })
      .setOrigin(0.5, 0.5);

    const worldWidth = screenWidth - margin * 2;
    const worldHeight = screenHeight - margin * 2;
    const imgDisplaySize = Math.min(
      worldWidth,
      worldHeight
    ) * 0.11;

    this.createTrapezoidGallery(worldWidth, worldHeight, margin, imgDisplaySize);

    this.setupInputHandlers(this, imgDisplaySize);

    // Load any existing shared paintings from Supabase
    loadPaintingsFromSupabase(this, imgDisplaySize);

    this.setupPhaserControls();
  }

  update() {
    if (!player || !player.body) return;

    player.body.setVelocity(0);

    if (window.ragecityControls) {
      const { up, down, left, right } = window.ragecityControls;
      const speed = 140;

      if (up) player.body.setVelocityY(-speed);
      if (down) player.body.setVelocityY(speed);
      if (left) player.body.setVelocityX(-speed);
      if (right) player.body.setVelocityX(speed);

      if (up && left) {
        player.body.setVelocity(
          -speed * Math.SQRT1_2,
          -speed * Math.SQRT1_2
        );
      } else if (up && right) {
        player.body.setVelocity(
          speed * Math.SQRT1_2,
          -speed * Math.SQRT1_2
        );
      } else if (down && left) {
        player.body.setVelocity(
          -speed * Math.SQRT1_2,
          speed * Math.SQRT1_2
        );
      } else if (down && right) {
        player.body.setVelocity(
          speed * Math.SQRT1_2,
          speed * Math.SQRT1_2
        );
      }
    }

    if (player.body.velocity.length() > 0) {
      player.body.velocity.normalize().scale(140);
    }

    if (sculptureCollider && sculptureCollider.body) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(
        player.getBounds(),
        sculptureCollider.getBounds()
      )) {
        promptText.setText("Press A to view art");
      } else {
        const overlayDiv = document.getElementById("rage-overlay");
        const defaultMsg = overlayDiv
          ? overlayDiv.getAttribute("data-message")
          : "Press A to view art";
        promptText.setText(defaultMsg);
      }
    }
  }

  drawGalleryLayout() {
    console.log("[RageCity] drawGalleryLayout()");
  }

  addLinesGeometry() {
    const g = this.add.graphics();
    g.lineStyle(6, 0xffffff, 1);

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const margin = 40;

    const left = margin;
    const right = w - margin;
    const top = margin + 60;
    const bottom = h - margin;

    g.strokeRect(left, top, right - left, bottom - top);

    const diagOffset = 60;
    g.beginPath();
    g.moveTo(left, top + diagOffset);
    g.lineTo(left + diagOffset, top);
    g.moveTo(right - diagOffset, top);
    g.lineTo(right, top + diagOffset);
    g.moveTo(left, bottom - diagOffset);
    g.lineTo(left + diagOffset, bottom);
    g.moveTo(right - diagOffset, bottom);
    g.lineTo(right, bottom - diagOffset);
    g.strokePath();

    const sculptureWidth = 130;
    const sculptureHeight = 90;
    const sculptureX = w / 2 - sculptureWidth / 2;
    const sculptureY = h / 2 - sculptureHeight / 2 + 10;

    g.strokeRect(sculptureX, sculptureY, sculptureWidth, sculptureHeight);

    const rect = this.add.rectangle(
      w / 2,
      h / 2 + 10,
      sculptureWidth,
      sculptureHeight
    );
    rect.setOrigin(0.5, 0.5);

    this.physics.add.existing(rect, true);
    rect.body.setAllowGravity(false);
    rect.body.setImmovable(true);

    return rect;
  }

  createTrapezoidGallery(worldWidth, worldHeight, margin, imgDisplaySize) {
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2 + 10;

    const li = 70;
    const lo = 10;
    const ti = 100;
    const to = 60;
    const ri = 70;
    const ro = 10;
    const bi = 160;
    const bo = 80;

    const leftOuter = centerX - worldWidth / 2 + lo;
    const leftInner = centerX - worldWidth / 2 + li;

    const rightOuter = centerX + worldWidth / 2 - ro;
    const rightInner = centerX + worldWidth / 2 - ri;

    const topOuter = centerY - worldHeight / 2 + to;
    const topInner = centerY - worldHeight / 2 + ti;

    const bottomOuter = centerY + worldHeight / 2 - bo;
    const bottomInner = centerY + worldHeight / 2 - bi;

    const g = this.add.graphics();
    g.lineStyle(8, 0xffffff, 1);

    g.beginPath();
    g.moveTo(leftOuter, topOuter + 60);
    g.lineTo(leftInner, topInner + 60);
    g.lineTo(rightInner, topInner + 60);
    g.lineTo(rightOuter, topOuter + 60);
    g.lineTo(rightOuter, bottomOuter);
    g.lineTo(rightInner, bottomInner);
    g.lineTo(leftInner, bottomInner);
    g.lineTo(leftOuter, bottomOuter);
    g.closePath();
    g.strokePath();

    const leftMatInset = 20;
    const rightMatInset = 20;
    const topMatInset = 20;
    const bottomMatInset = 20;

    const gMat = this.add.graphics();
    gMat.lineStyle(4, 0xffffff, 0.7);

    gMat.beginPath();
    gMat.moveTo(leftOuter + leftMatInset, topOuter + 60 + topMatInset);
    gMat.lineTo(leftInner - leftMatInset, topInner + 60 + topMatInset);
    gMat.lineTo(rightInner - rightMatInset, topInner + 60 + topMatInset);
    gMat.lineTo(rightOuter - rightMatInset, topOuter + 60 + topMatInset);
    gMat.lineTo(rightOuter - rightMatInset, bottomOuter - bottomMatInset);
    gMat.lineTo(rightInner - rightMatInset, bottomInner - bottomMatInset);
    gMat.lineTo(leftInner + leftMatInset, bottomInner - bottomMatInset);
    gMat.lineTo(leftOuter + leftMatInset, bottomOuter - bottomMatInset);
    gMat.closePath();
    gMat.strokePath();

    const imgWidth = imgDisplaySize;
    const imgHeight = imgDisplaySize;

    const allFrames = [];

    const topCount = 7;
    const bottomCount = 7;
    const sideCount = 4;

    for (let i = 0; i < topCount; i++) {
      const t = i / (topCount - 1 || 1);
      const x = Phaser.Math.Linear(
        leftInner + imgWidth,
        rightInner - imgWidth,
        t
      );
      const y = topInner + 60 + imgHeight * 0.1;
      const side = "top";
      allFrames.push({ x, y, side });
    }

    for (let i = 0; i < bottomCount; i++) {
      const t = i / (bottomCount - 1 || 1);
      const x = Phaser.Math.Linear(
        leftInner + imgWidth,
        rightInner - imgWidth,
        t
      );
      const y = bottomInner - imgHeight * 0.1;
      const side = "bottom";
      allFrames.push({ x, y, side });
    }

    for (let i = 0; i < sideCount; i++) {
      const t = i / (sideCount - 1 || 1);
      let x = leftInner - imgWidth * 0.1;
      let y = Phaser.Math.Linear(
        topInner + 60 + imgHeight,
        bottomInner - imgHeight,
        t
      );
      let side = "left";

      if (i >= 0) {
        x = rightInner + imgWidth * 0.1;
        side = "right";
      }

      allFrames.push({ x, y, side });
    }

    allFrames.forEach((f) => {
      this.addTrapezoidFrame(
        f.x,
        f.y,
        f.side,
        g,
        gMat,
        imgWidth,
        imgHeight
      );
    });
  }

  addTrapezoidFrame(
    x,
    y,
    side,
    g,
    gMat,
    imgWidth,
    imgHeight
  ) {
    const frameWidth = imgWidth * 0.9;
    const frameHeight = imgHeight * 0.9;

    let corners = [];

    if (side === "top") {
      corners = [
        { x: x - frameWidth / 2, y: y + frameHeight / 2 },
        { x: x + frameWidth / 2, y: y + frameHeight / 2 },
        { x: x + frameWidth / 2.5, y: y - frameHeight / 2 },
        { x: x - frameWidth / 2.5, y: y - frameHeight / 2 },
      ];
    } else if (side === "bottom") {
      corners = [
        { x: x - frameWidth / 2.5, y: y + frameHeight / 2 },
        { x: x + frameWidth / 2.5, y: y + frameHeight / 2 },
        { x: x + frameWidth / 2, y: y - frameHeight / 2 },
        { x: x - frameWidth / 2, y: y - frameHeight / 2 },
      ];
    } else if (side === "left") {
      corners = [
        { x: x + frameWidth / 2, y: y - frameHeight / 2.3 },
        { x: x + frameWidth / 2, y: y + frameHeight / 2.3 },
        { x: x - frameWidth / 2.1, y: y + frameHeight / 2 },
        { x: x - frameWidth / 2.1, y: y - frameHeight / 2 },
      ];
    } else if (side === "right") {
      corners = [
        { x: x + frameWidth / 2.1, y: y - frameHeight / 2 },
        { x: x + frameWidth / 2.1, y: y + frameHeight / 2 },
        { x: x - frameWidth / 2, y: y + frameHeight / 2.3 },
        { x: x - frameWidth / 2, y: y - frameHeight / 2.3 },
      ];
    }

    gMat.lineStyle(4, 0x00ff00, 1);
    gMat.beginPath();
    gMat.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      gMat.lineTo(corners[i].x, corners[i].y);
    }
    gMat.closePath();
    gMat.strokePath();

    galleryFrames.push({
      x,
      y,
      side,
      frameGfx: g,
      matGfx: gMat,
      img: null,
      fullUrl: null,
      storagePath: null
    });
  }

  setupInputHandlers(scene, imgDisplaySize) {
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

        const now = performance.now();
        if (now - lastInteractionTime < INTERACTION_COOLDOWN) {
          console.log(
            "[RageCity] Interaction cooldown active, ignoring input."
          );
          this.value = "";
          return;
        }
        lastInteractionTime = now;

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

        const reader = new FileReader();
        reader.onload = function (ev) {
          const dataUrl = ev.target.result;
          const texKeyLocal = `localPainting-${frameIndex}`;

          console.log("[RageCity] FileReader loaded data URL for frame", frameIndex);

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

          frame.fullUrl = dataUrl;

          console.log("[RageCity] Local preview applied for frame", frameIndex);

          // 2) Fire Supabase upload in the background
          (async () => {
            const result = await uploadPaintingToSupabase(
              frameIndex,
              file,
              frame.storagePath
            );
            if (result && result.publicUrl) {
              frame.fullUrl = result.publicUrl;
              frame.storagePath = result.storagePath;
              console.log("[RageCity] Frame updated with Supabase URL", {
                frameIndex,
                publicUrl: result.publicUrl,
                storagePath: result.storagePath,
              });
            } else {
              console.warn(
                "[RageCity] Supabase upload returned null for frame",
                frameIndex
              );
            }
          })();
        };

        reader.onerror = function (ev) {
          console.error("[RageCity] FileReader error:", ev);
          alert("RageCity error reading file from device.");
        };

        reader.readAsDataURL(file);
        this.value = "";
      });
    } else {
      console.warn(
        "[RageCity] No #paintingUpload element found – uploads disabled."
      );
    }

    window.ragecityOpenUploader = () => {
      if (paintingUploadInput) {
        paintingUploadInput.click();
      } else {
        alert("Upload not available.");
      }
    };
  }

  setupPhaserControls() {
    this.input.keyboard.on("keydown-A", () => {
      console.log("[RageCity] Keyboard A pressed => view/replace art.");
      handleActionButton(this, "A");
    });

    this.input.keyboard.on("keydown-B", () => {
      console.log("[RageCity] Keyboard B pressed => replace art.");
      handleActionButton(this, "B");
    });
  }
}

function isNearAnyPainting(playerRect) {
  let closestIndex = null;
  let closestDist = Infinity;

  galleryFrames.forEach((frame, index) => {
    const frameRect = new Phaser.Geom.Rectangle(
      frame.x - 30,
      frame.y - 30,
      60,
      60
    );

    if (Phaser.Geom.Intersects.RectangleToRectangle(playerRect, frameRect)) {
      const dx = frame.x - playerRect.centerX;
      const dy = frame.y - playerRect.centerY;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = index;
      }
    }
  });

  return closestIndex;
}

async function handleActionButton(scene, button) {
  const now = performance.now();
  if (now - lastInteractionTime < INTERACTION_COOLDOWN) {
    console.log(
      "[RageCity] Interaction cooldown active, ignoring button press."
    );
    return;
  }
  lastInteractionTime = now;

  const playerRect = player.getBounds();
  const frameIndex = isNearAnyPainting(playerRect);

  if (frameIndex === null) {
    console.log("[RageCity] Player not near any painting frame.");
    return;
  }

  const frame = galleryFrames[frameIndex];
  currentPaintingIndex = frameIndex;

  console.log(`[RageCity] Player near painting frame #${frameIndex}`);

  if (button === "A") {
    if (frame.fullUrl) {
      console.log("[RageCity] Opening existing art fullscreen:", frame.fullUrl);
      openFullscreenImage(frame.fullUrl);
    } else {
      console.log("[RageCity] No existing art; triggering upload picker.");
      if (window.ragecityOpenUploader) {
        window.ragecityOpenUploader();
      }
    }
  } else if (button === "B") {
    console.log("[RageCity] B button pressed – replace art flow.");
    if (window.ragecityOpenUploader) {
      window.ragecityOpenUploader();
    }
  }
}

function openFullscreenImage(url) {
  const overlay = document.getElementById("rage-fullscreen-overlay");
  const img = document.getElementById("rage-fullscreen-img");
  if (!overlay || !img) {
    console.warn(
      "[RageCity] Fullscreen elements missing (rage-fullscreen-overlay / rage-fullscreen-img)."
    );
    return;
  }

  img.src = url;
  overlay.style.display = "flex";
  isFullscreen = true;

  overlay.onclick = () => {
    overlay.style.display = "none";
    img.src = "";
    isFullscreen = false;
    overlay.onclick = null;
  };
}

async function loadPaintingsFromSupabase(scene, imgDisplaySize) {
  if (!window.supabase) {
    console.warn(
      "[RageCity] Supabase client missing; skipping shared gallery load."
    );
    return;
  }

  try {
    console.log(
      "[RageCity] Loading paintings from Supabase table:",
      PAINTINGS_TABLE
    );

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

    console.log("[RageCity] Paintings loaded from table:", data);

    if (!data || !data.length) return;

    data.forEach((row) => {
      const idx = row.frame_index;
      if (idx < 0 || idx >= galleryFrames.length) return;

      const publicUrl = row.image_url || "";
      let storagePath = null;
      const splitToken = `/object/public/${GALLERY_BUCKET}/`;
      const parts = publicUrl.split(splitToken);
      if (parts.length === 2) {
        storagePath = parts[1].split("?")[0];
      }
      row._storagePath = storagePath;

      const texKey = `supPainting-${idx}`;
      console.log(
        `[RageCity] Queueing image load for frame ${idx}:`,
        publicUrl,
        "→ texture key:",
        texKey
      );
      if (publicUrl) {
        scene.load.image(texKey, publicUrl);
      }
    });

    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      console.log("[RageCity] Supabase images load COMPLETE event fired.");
      data.forEach((row) => {
        const idx = row.frame_index;
        const frame = galleryFrames[idx];
        if (!frame) return;
        const texKey = `supPainting-${idx}`;
        if (!scene.textures.exists(texKey)) {
          console.warn(
            "[RageCity] Texture key missing for frame",
            idx,
            texKey
          );
          return;
        }

        if (frame.img) {
          frame.img.destroy();
        }

        const img = scene.add.image(frame.x, frame.y, texKey);
        img.setDisplaySize(imgDisplaySize, imgDisplaySize);
        frame.img = img;
        frame.fullUrl = row.image_url;
        frame.storagePath = row._storagePath || null;

        console.log("[RageCity] Applied Supabase painting to frame", idx, {
          url: row.image_url,
          storagePath: frame.storagePath,
        });
      });
    });

    scene.load.start();
  } catch (err) {
    console.error(
      "[RageCity] Unexpected error loading paintings:",
      err
    );
  }
}

// Upload + upsert, then (best-effort) delete old file; return { publicUrl, storagePath }
async function uploadPaintingToSupabase(frameIndex, file, oldStoragePath) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase client missing; cannot upload.");
    return null;
  }

  try {
    const ext = (file.type && file.type.split("/")[1]) || "png";

    const timestamp = Date.now();
    const fileName = `painting_${frameIndex}_${timestamp}.${ext}`;
    const filePath = `paintings/${fileName}`;

    console.log("[RageCity] Starting upload to Supabase:", {
      bucket: GALLERY_BUCKET,
      filePath,
      frameIndex,
      fileType: file.type,
      fileSize: file.size,
    });

    const { data: uploadData, error: uploadError } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      console.error(
        "[RageCity] Error uploading painting to bucket:",
        uploadError
      );
      alert("RageCity upload error (Storage): " + uploadError.message);
      return null;
    }

    console.log("[RageCity] Storage upload success:", uploadData);

    const { data: publicData, error: publicErr } = window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .getPublicUrl(filePath);

    if (publicErr) {
      console.error("[RageCity] Error getting public URL:", publicErr);
      alert("RageCity upload error (public URL): " + publicErr.message);
      return null;
    }

    const publicUrl = publicData?.publicUrl;
    console.log("[RageCity] Public URL for painting:", publicUrl);

    if (!publicUrl) {
      console.error("[RageCity] Could not get public URL for painting.");
      alert("RageCity upload error: public URL missing");
      return null;
    }

    const { data: upsertData, error: upsertError } = await window.supabase
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
      alert("RageCity upload error (DB upsert): " + upsertError.message);
    } else {
      console.log("[RageCity] Painting DB upsert success:", upsertData);
    }

    if (oldStoragePath) {
      console.log(
        "[RageCity] Attempting to delete previous painting:",
        oldStoragePath
      );
      const { error: deleteError } = await window.supabase
        .storage
        .from(GALLERY_BUCKET)
        .remove([oldStoragePath]);

      if (deleteError) {
        console.warn(
          "[RageCity] Could not delete previous painting (likely RLS or missing file):",
          deleteError
        );
      } else {
        console.log(
          "[RageCity] Previous painting deleted from bucket:",
          oldStoragePath
        );
      }
    }

    console.log(
      "[RageCity] Upload + DB save complete for frame",
      frameIndex
    );
    return { publicUrl, storagePath: filePath };
  } catch (err) {
    console.error(
      "[RageCity] Unexpected error uploading painting:",
      err
    );
    alert("RageCity upload error (unexpected): " + err.message);
    return null;
  }
}

window.CityScene = CityScene;