// ragecity/js/overlay.js
// SAFE incremental upgrade: supports title + description without breaking old calls

let artOpen = false;

const overlayEl = document.getElementById("art-overlay");
const imgEl = document.getElementById("art-overlay-img");
const msgEl = document.getElementById("art-overlay-msg");
const titleEl = document.getElementById("art-overlay-title");
const descEl = document.getElementById("art-overlay-description");

// Track fullscreen state
function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement
  );
}

// --------------------
// Open overlay
// --------------------
// Supports:
//   openArtOverlay("url")
//   openArtOverlay({ url, title, description })
window.openArtOverlay = function openArtOverlay(arg) {
  let url = "";
  let title = "";
  let description = "";

  if (typeof arg === "string") {
    url = arg;
  } else if (arg && typeof arg === "object") {
    url = arg.url || "";
    title = arg.title || "";
    description = arg.description || "";
  }

  if (!url) return;

  artOpen = true;

  imgEl.src = url;
  overlayEl.style.display = "flex";

  // Populate text bubble
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = description;

  // Show bubble only if there is text AND not fullscreen
  if (msgEl) {
    const hasText = !!(title || description);
    msgEl.style.display = hasText && !isFullscreen()
      ? "block"
      : "none";
  }
};

// --------------------
// Close overlay
// --------------------
window.closeArtOverlay = function closeArtOverlay() {
  artOpen = false;
  overlayEl.style.display = "none";
  if (msgEl) msgEl.style.display = "none";
};

// --------------------
// Toggle fullscreen
// --------------------
window.toggleArtFullscreen = function toggleArtFullscreen() {
  if (!imgEl) return;

  // Enter fullscreen
  if (!isFullscreen()) {
    if (imgEl.requestFullscreen) {
      imgEl.requestFullscreen();
    } else if (imgEl.webkitRequestFullscreen) {
      imgEl.webkitRequestFullscreen();
    }

    // Hide bubble in fullscreen
    if (msgEl) msgEl.style.display = "none";
    return;
  }

  // Exit fullscreen
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  }

  // Restore bubble after exiting fullscreen (if text exists)
  setTimeout(() => {
    if (!artOpen || !msgEl) return;
    const hasText =
      (titleEl && titleEl.textContent) ||
      (descEl && descEl.textContent);

    msgEl.style.display = hasText ? "block" : "none";
  }, 150);
};

// --------------------
// Overlay click = close
// --------------------
overlayEl.addEventListener("click", () => {
  if (!artOpen) return;
  window.closeArtOverlay();
});