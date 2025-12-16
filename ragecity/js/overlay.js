// RageCity overlay.js — IMAGE + VIDEO support (private bucket friendly)
// Backward compatible with openArtOverlay("url")

// Optional defaults
const PAINTING_FULL_URL =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2000&q=80";
const SCULPTURE_FULL_URL =
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=2000&q=80";

let artOpen = false;

const artOverlayEl = document.getElementById("art-overlay");
const artImg = document.getElementById("art-overlay-img");
const artMsg = document.getElementById("art-overlay-msg");

// We will either use an existing <video id="art-overlay-video"> if you add it,
// or we’ll create one dynamically so you don’t have to edit index.html.
let artVideo = document.getElementById("art-overlay-video");

// Track which element is currently active (img or video)
let currentMediaEl = artImg;

// ---------- helpers ----------
function isVideo(mimeType, url) {
  const mt = String(mimeType || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  const u = String(url || "").toLowerCase();
  return u.endsWith(".mp4") || u.endsWith(".webm") || u.endsWith(".mov") || u.endsWith(".m4v");
}

function ensureVideoEl() {
  if (artVideo) return artVideo;
  if (!artOverlayEl) return null;

  artVideo = document.createElement("video");
  artVideo.id = "art-overlay-video";
  artVideo.controls = true;
  artVideo.playsInline = true;
  artVideo.preload = "metadata";
  artVideo.style.maxWidth = "92vw";
  artVideo.style.maxHeight = "72vh";
  artVideo.style.display = "none";

  // Put it next to the image inside overlay
  if (artImg && artImg.parentNode) {
    artImg.parentNode.insertBefore(artVideo, artImg.nextSibling);
  } else {
    artOverlayEl.appendChild(artVideo);
  }

  return artVideo;
}

function stopVideoIfAny() {
  if (!artVideo) return;
  try { artVideo.pause(); } catch (_) {}
  // Clear src so mobile browsers stop streaming
  try {
    artVideo.removeAttribute("src");
    artVideo.load();
  } catch (_) {}
}

function exitArtFullscreenIfNeeded() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;

  // If our media is fullscreen, exit
  if (fsEl && (fsEl === artImg || fsEl === artVideo)) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

// ---------- API used by CityScene ----------

// Open overlay with either:
//  - openArtOverlay("https://...")  (legacy)
//  - openArtOverlay({ url: "https://...", mimeType: "video/mp4" })
function openArtOverlay(arg) {
  let url = null;
  let mimeType = "";

  if (typeof arg === "string") {
    url = arg;
  } else if (arg && typeof arg === "object") {
    url = arg.url || null;
    mimeType = arg.mimeType || "";
  }

  if (!url) return;

  artOpen = true;

  const showVideo = isVideo(mimeType, url);

  // Reset
  if (artImg) {
    artImg.style.display = "none";
    artImg.src = "";
  }
  if (ensureVideoEl()) {
    artVideo.style.display = "none";
    stopVideoIfAny();
  }

  // Apply
  if (showVideo) {
    ensureVideoEl();
    if (artVideo) {
      artVideo.src = url;
      artVideo.style.display = "block";
      currentMediaEl = artVideo;
    }
    if (artMsg) {
      artMsg.style.display = "block";
      artMsg.textContent = 'Tap play (video) — Press "A" for fullscreen';
    }
  } else {
    if (artImg) {
      artImg.src = url;
      artImg.style.display = "block";
      currentMediaEl = artImg;
    }
    if (artMsg) {
      artMsg.style.display = "block";
      artMsg.textContent = 'Press "A" for fullscreen';
    }
  }

  if (artOverlayEl) {
    artOverlayEl.style.display = "flex";
  }
}

// Close overlay AND exit fullscreen if needed
function closeArtOverlay() {
  if (!artOpen) return;

  exitArtFullscreenIfNeeded();
  stopVideoIfAny();

  artOpen = false;

  if (artOverlayEl) artOverlayEl.style.display = "none";
  if (artMsg) artMsg.style.display = "block";
}

// Toggle fullscreen on whichever media is currently showing
function toggleArtFullscreen() {
  if (artMsg) artMsg.style.display = "none";

  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  const target = currentMediaEl || artImg;

  if (!target) return;

  if (fsEl === target) {
    exitArtFullscreenIfNeeded();
    return;
  }

  // Request fullscreen
  if (target.requestFullscreen) target.requestFullscreen();
  else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
}

// Click ANYWHERE on the overlay (image/video/background) to close it
if (artOverlayEl) {
  artOverlayEl.addEventListener("click", () => {
    if (artOpen) closeArtOverlay();
  });
}

// Expose functions to global (CityScene calls these)
window.artOpen = artOpen; // NOTE: CityScene reads window.artOpen, but this primitive won't auto-update.
window.openArtOverlay = openArtOverlay;
window.closeArtOverlay = closeArtOverlay;
window.toggleArtFullscreen = toggleArtFullscreen;

// Keep window.artOpen in sync (so CityScene overlay-open checks work)
Object.defineProperty(window, "artOpen", {
  get() { return artOpen; },
  set(v) { artOpen = !!v; }
});