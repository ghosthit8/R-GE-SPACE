// Optional defaults (you can keep or remove these; CityScene now passes a data URL)
const PAINTING_FULL_URL =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2000&q=80";
const SCULPTURE_FULL_URL =
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=2000&q=80";

let artOpen = false;

const artOverlayEl = document.getElementById("art-overlay");
const artImg = document.getElementById("art-overlay-img");
const artMsg = document.getElementById("art-overlay-msg");

// Open overlay with a given image URL (data URL from upload or static URL)
function openArtOverlay(imageUrl) {
  artOpen = true;

  if (imageUrl && artImg) {
    artImg.src = imageUrl;
  }

  if (artOverlayEl) {
    artOverlayEl.style.display = "flex";
  }

  if (artMsg) {
    artMsg.style.display = "block";
  }
}

// Helper: exit fullscreen if the art image is currently fullscreen
function exitArtFullscreenIfNeeded() {
  const fsEl =
    document.fullscreenElement || document.webkitFullscreenElement;

  if (fsEl === artImg) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

// Close overlay AND exit fullscreen if needed
function closeArtOverlay() {
  if (!artOpen) return;

  // Make sure we’re not stuck in fullscreen
  exitArtFullscreenIfNeeded();

  artOpen = false;

  if (artOverlayEl) {
    artOverlayEl.style.display = "none";
  }
}

// Toggle fullscreen on the art image.
// Called from the game loop when A is pressed while overlay is open.
function toggleArtFullscreen() {
  if (artMsg) {
    artMsg.style.display = "none";
  }

  const fsEl =
    document.fullscreenElement || document.webkitFullscreenElement;

  if (fsEl === artImg) {
    // Already fullscreen → exit
    exitArtFullscreenIfNeeded();
  } else {
    // Not fullscreen yet → request it
    if (artImg.requestFullscreen) {
      artImg.requestFullscreen();
    } else if (artImg.webkitRequestFullscreen) {
      artImg.webkitRequestFullscreen();
    }
  }
}

// Click ANYWHERE on the overlay (image or background) to close it
if (artOverlayEl) {
  artOverlayEl.addEventListener("click", () => {
    if (artOpen) {
      closeArtOverlay();
    }
  });
}