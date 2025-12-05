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

// Handle file selection
if (addArtFileInput) {
  addArtFileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || addArtFrameIndex == null || !window.galleryFrames) {
      closeAddArtMenu();
      return;
    }

    const frame = window.galleryFrames[addArtFrameIndex];
    if (!frame) {
      closeAddArtMenu();
      return;
    }

    // For now we support images only
    if (!file.type.startsWith("image/")) {
      alert("For now, please choose an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = function (evt) {
      const imgData = evt.target.result;
      const img = new Image();
      img.onload = function () {
        const texKey = "frame_upload_" + addArtFrameIndex;
        const game = Phaser.GAMES && Phaser.GAMES[0];

        // Safely add/update the texture if we have a game instance
        if (game && game.textures) {
          if (game.textures.exists(texKey)) {
            game.textures.remove(texKey);
          }
          game.textures.addImage(texKey, img);

          // Update the thumbnail + full-size URL in the frame
          frame.img.setTexture(texKey);
          frame.fullUrl = imgData;
        }

        closeAddArtMenu();
      };
      img.src = imgData;
    };
    reader.readAsDataURL(file);
  });
}