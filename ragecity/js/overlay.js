// overlay.js
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

// Simple logger so we can see overlay activity clearly in the console
function overlayDbg(msg) {
  console.log(
    "%c[RageCity OVERLAY] " + msg,
    "color:#0f0;background:#000;padding:2px 4px;"
  );
}

function getSupabase() {
  const supa = window.supabaseClient;
  if (!supa) {
    console.warn("Supabase client not configured for Rage City.");
  }
  return supa;
}

function openArtOverlay(imageUrl) {
  // If no image assigned (null painting), do nothing
  if (!imageUrl) {
    overlayDbg("openArtOverlay called with empty URL – ignoring");
    return;
  }

  overlayDbg("openArtOverlay called with URL: " + imageUrl);

  artOpen = true;
  if (artImg) {
    artImg.src = imageUrl;
    artImg.style.opacity = "1";
  }
  if (artOverlayEl) {
    artOverlayEl.style.display = "flex";
    artOverlayEl.style.opacity = "1";
    artOverlayEl.style.pointerEvents = "auto";
  }
  if (artMsg) {
    artMsg.style.display = "block";
    artMsg.style.opacity = "1";
  }
}

function closeArtOverlay() {
  overlayDbg("closeArtOverlay called");
  artOpen = false;
  if (artOverlayEl) {
    artOverlayEl.style.opacity = "0";
    artOverlayEl.style.display = "none";
    artOverlayEl.style.pointerEvents = "none";
  }
  if (artMsg) {
    artMsg.style.display = "none";
    artMsg.style.opacity = "0";
  }

  if (
    (document.fullscreenElement === artImg ||
      document.webkitFullscreenElement === artImg) &&
    document.exitFullscreen
  ) {
    document.exitFullscreen();
  }
}

function toggleArtFullscreen() {
  overlayDbg("toggleArtFullscreen called");
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
  overlayDbg("openAddArtMenu for frameIndex=" + frameIndex);
  addArtFrameIndex = frameIndex;
  addArtOpen = true;
  if (addArtOverlayEl) {
    addArtOverlayEl.style.display = "flex";
    addArtOverlayEl.style.opacity = "1";
    addArtOverlayEl.style.pointerEvents = "auto";
  }
}

function closeAddArtMenu() {
  overlayDbg("closeAddArtMenu called");
  addArtOpen = false;
  addArtFrameIndex = null;
  if (addArtOverlayEl) {
    addArtOverlayEl.style.display = "none";
    addArtOverlayEl.style.opacity = "0";
    addArtOverlayEl.style.pointerEvents = "none";
  }
}

// Trigger the file picker (used by button and by A key)
function triggerAddArtFilePicker() {
  overlayDbg("triggerAddArtFilePicker called");
  if (addArtFileInput) {
    addArtFileInput.value = ""; // reset
    addArtFileInput.click();
  }
}

// Button wiring
if (addArtUploadButton && addArtFileInput) {
  addArtUploadButton.addEventListener("click", () => {
    overlayDbg("Upload button clicked");
    triggerAddArtFilePicker();
  });
}

if (addArtCancelButton) {
  addArtCancelButton.addEventListener("click", () => {
    overlayDbg("Cancel button clicked");
    closeAddArtMenu();
  });
}

// Helper: apply a public URL to a frame (thumbnail + full)
function applyUrlToFrame(frameIndex, publicUrl) {
  overlayDbg("applyUrlToFrame(" + frameIndex + ", " + publicUrl + ")");
  if (!window.galleryFrames) {
    overlayDbg("No galleryFrames on window yet");
    return;
  }
  const frame = window.galleryFrames[frameIndex];
  if (!frame || !publicUrl) {
    overlayDbg("Frame not found or URL missing");
    return;
  }

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
      overlayDbg("No Supabase client; cannot upload");
      closeAddArtMenu();
      return;
    }

    const file = e.target.files && e.target.files[0];
    if (!file || addArtFrameIndex == null) {
      overlayDbg("No file or frame index; closing menu");
      closeAddArtMenu();
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("For now, please choose an image file.");
      overlayDbg("Non-image file selected: " + file.type);
      return;
    }

    overlayDbg(
      "Starting upload for frame " +
        addArtFrameIndex +
        " file=" +
        file.name +
        " type=" +
        file.type
    );

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
        overlayDbg("Upload error: " + uploadError.message);
        closeAddArtMenu();
        return;
      }

      // 2) Get public URL
      const { data: pub } = supa.storage
        .from(RAGECITY_BUCKET)
        .getPublicUrl(storagePath);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) {
        overlayDbg("Could not generate public URL");
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
        overlayDbg("DB upsert error: " + upsertError.message);
        // still continue; art will show even if DB doesn't track it perfectly
      }

      // 4) Update the running game
      overlayDbg("Upload + DB done; applying to frame");
      applyUrlToFrame(addArtFrameIndex, publicUrl);
    } catch (err) {
      console.error("Unexpected upload error:", err);
      overlayDbg("Unexpected upload error: " + err.message);
      alert("Upload error: " + err.message);
    } finally {
      closeAddArtMenu();
    }
  });
}

// ===== Auto-debug & test overlay on page load =====
window.addEventListener("load", () => {
  overlayDbg("Auto-debug init on page load");
  // mark that we're in debug mode for any other scripts
  window.__RAGECITY_DEBUG = true;

  // Bump overlay z-indexes just to be extra safe visually
  const ao = document.getElementById("art-overlay");
  const aa = document.getElementById("add-art-overlay");
  if (ao) {
    ao.style.zIndex = "999999";
  }
  if (aa) {
    aa.style.zIndex = "1000000";
  }

  // Force-open an overlay so any graphics / layering issues are visible immediately
  setTimeout(() => {
    if (typeof openArtOverlay === "function") {
      overlayDbg("Auto-opening test art overlay on load");
      const testUrl =
        SCULPTURE_FULL_URL ||
        "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2000&q=80";
      openArtOverlay(testUrl);
    } else {
      overlayDbg("openArtOverlay not defined yet on load");
    }
  }, 800);
});