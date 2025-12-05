// Full-size artwork URLs for frames & sculpture
// Paintings start empty; sculpture still has a default piece.
const PAINTING_FULL_URL = null;
const SCULPTURE_FULL_URL =
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=2000&q=80";

let artOpen = false;
let addArtOpen = false;
let addArtFrameIndex = null;

const artOverlayEl = document.getElementById("art-overlay");
const artImg = document.getElementById("art-overlay-img");
const artMsg = document.getElementById("art-overlay-msg");

// Add-art overlay elements
const addArtOverlayEl = document.getElementById("add-art-overlay");
const addArtFileInput = document.getElementById("add-art-file-input");
const addArtUploadButton = document.getElementById("add-art-upload-button");
const addArtCancelButton = document.getElementById("add-art-cancel");

const RAGECITY_BUCKET = "ragecity-art";

function getSupabase() {
  const supa = window.supabaseClient;
  if (!supa) {
    console.warn("Supabase client not configured for Rage City.");
  }
  return supa;
}

function openArtOverlay(imageUrl) {
  // If no image assigned (null painting), do nothing
  if (!imageUrl) return;

  artOpen = true;
  if (artImg) artImg.src = imageUrl;
  if (artOverlayEl) artOverlayEl.style.display = "flex";
  if (artMsg) artMsg.style.display = "block";
}

function closeArtOverlay() {
  artOpen = false;
  if (artOverlayEl) artOverlayEl.style.display = "none";
  if (artMsg) artMsg.style.display = "none";

  if (
    (document.fullscreenElement === artImg ||
      document.webkitFullscreenElement === artImg) &&
    document.exitFullscreen
  ) {
    document.exitFullscreen();
  }
}

function toggleArtFullscreen() {
  if (artMsg) artMsg.style.display = "none";
  if (
    document.fullscreenElement === artImg ||
    document.webkitFullscreenElement === artImg
  ) {
    if (document.exitFullscreen) document.exitFullscreen();
  } else {
    if (artImg && artImg.requestFullscreen) {
      artImg.requestFullscreen();
    }
  }
}

// ===== ADD-ART MENU LOGIC =====

function openAddArtMenu(frameIndex) {
  addArtFrameIndex = frameIndex;
  addArtOpen = true;
  if (addArtOverlayEl) addArtOverlayEl.style.display = "flex";
}

function closeAddArtMenu() {
  addArtOpen = false;
  addArtFrameIndex = null;
  if (addArtOverlayEl) addArtOverlayEl.style.display = "none";
}

// Trigger the file picker (used by button and by A key)
function triggerAddArtFilePicker() {
  if (addArtFileInput) {
    addArtFileInput.value = ""; // reset
    addArtFileInput.click();
  }
}

// Button wiring
if (addArtUploadButton && addArtFileInput) {
  addArtUploadButton.addEventListener("click", () => {
    triggerAddArtFilePicker();
  });
}

if (addArtCancelButton) {
  addArtCancelButton.addEventListener("click", () => {
    closeAddArtMenu();
  });
}

// Helper: apply a public URL to a frame (thumbnail + full)
function applyUrlToFrame(frameIndex, publicUrl) {
  if (!window.galleryFrames) return;
  const frame = window.galleryFrames[frameIndex];
  if (!frame || !publicUrl) return;

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

// Handle file selection → upload to Supabase
if (addArtFileInput) {
  addArtFileInput.addEventListener("change", async (e) => {
    const supa = getSupabase();
    if (!supa) {
      closeAddArtMenu();
      return;
    }

    const file = e.target.files && e.target.files[0];
    if (!file || addArtFrameIndex == null) {
      closeAddArtMenu();
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("For now, please choose an image file.");
      return;
    }

    try {
      const pathSafeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const storagePath = `frame-${addArtFrameIndex}-${Date.now()}-${pathSafeName}`;

      // 1) Upload to bucket
      const { error: uploadError } = await supa.storage
        .from(RAGECITY_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: true
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        alert("Upload error: " + uploadError.message);
        closeAddArtMenu();
        return;
      }

      // 2) Get public URL
      const { data: pub } = supa.storage.from(RAGECITY_BUCKET).getPublicUrl(storagePath);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) {
        alert("Could not generate image URL.");
        closeAddArtMenu();
        return;
      }

      // 3) Upsert DB row
      const { error: upsertError } = await supa
        .from("ragecity_frames")
        .upsert(
          { frame_index: addArtFrameIndex, storage_path: storagePath },
          { onConflict: "frame_index" }
        );

      if (upsertError) {
        console.error("DB upsert error:", upsertError);
        // not fatal for showing the art
      }

      // 4) Update the running game
      applyUrlToFrame(addArtFrameIndex, publicUrl);
    } catch (err) {
      console.error("Unexpected upload error:", err);
      alert("Upload error: " + err.message);
    } finally {
      closeAddArtMenu();
    }
  });
}