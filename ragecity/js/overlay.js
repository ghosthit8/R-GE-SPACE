// Full-size artwork URLs for frames & sculpture
// (These constants are unused now, but you can keep/remove them.)
const PAINTING_FULL_URL =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2000&q=80";
const SCULPTURE_FULL_URL =
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=2000&q=80";

let artOpen = false;

const artOverlayEl = document.getElementById("art-overlay");
const artImg = document.getElementById("art-overlay-img");
const artMsg = document.getElementById("art-overlay-msg");

function openArtOverlay(imageUrl) {
  artOpen = true;
  if (imageUrl && artImg) artImg.src = imageUrl;
  if (artOverlayEl) artOverlayEl.style.display = "flex";
  if (artMsg) artMsg.style.display = "block";
}

function closeArtOverlay() {
  artOpen = false;
  if (artOverlayEl) artOverlayEl.style.display = "none";
}

function toggleArtFullscreen() {
  if (artMsg) artMsg.style.display = "none";

  const fsEl =
    document.fullscreenElement || document.webkitFullscreenElement;

  if (fsEl === artImg) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } else {
    if (artImg.requestFullscreen) {
      artImg.requestFullscreen();
    } else if (artImg.webkitRequestFullscreen) {
      artImg.webkitRequestFullscreen();
    }
  }
}

// NEW: if art is open in fullscreen, clicking anywhere exits fullscreen
document.addEventListener("click", function () {
  if (!artOpen) return;

  const fsEl =
    document.fullscreenElement || document.webkitFullscreenElement;

  // Only react when the art image itself is what's fullscreen
  if (fsEl === artImg) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
});