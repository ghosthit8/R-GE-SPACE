// ============================================================
// ragecity-gallery-helpers.js
// Split from cityScene.js to reduce bulk.
// Must be loaded BEFORE cityScene.js in your HTML.
// ============================================================

// Shared config
const GALLERY_BUCKET = "ragecity-gallery";
const PAINTINGS_TABLE = "ragecity_paintings";
const SIGNED_URL_EXPIRES_SECONDS = 60 * 30; // 30 minutes

console.log("[RageCity] Helpers loaded. Supabase present?", !!window.supabase);

// ---------------------- UTILITIES ---------------------- //
function isVideoFile(mimeType, pathOrUrl) {
  const mt = (mimeType || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  const s = String(pathOrUrl || "").toLowerCase();
  return s.endsWith(".mp4") || s.endsWith(".webm") || s.endsWith(".mov") || s.endsWith(".m4v");
}

async function getSignedUrl(bucket, path, expiresSeconds = SIGNED_URL_EXPIRES_SECONDS) {
  const { data, error } = await window.supabase
    .storage
    .from(bucket)
    .createSignedUrl(path, expiresSeconds);

  if (error) throw error;
  return data?.signedUrl || null;
}

function clearFrameMedia(frame) {
  if (!frame) return;
  if (frame.img) { try { frame.img.destroy(); } catch (_) {} frame.img = null; }
  if (frame.playIcon) { try { frame.playIcon.destroy(); } catch (_) {} frame.playIcon = null; }
  if (frame.localTexKey && frame.scene?.textures?.exists(frame.localTexKey)) {
    try { frame.scene.textures.remove(frame.localTexKey); } catch (_) {}
  }
  frame.localTexKey = null;
  frame.mediaKind = null;
  frame.mimeType = "";
}

function attachVideoMarker(scene, frame) {
  if (frame.playIcon) { try { frame.playIcon.destroy(); } catch (_) {} }
  frame.playIcon = scene.add.text(frame.x, frame.y, "▶", {
    fontFamily: "system-ui, sans-serif",
    fontSize: "18px",
    color: "#39ff14"
  }).setOrigin(0.5).setDepth(11);
  scene.children.bringToTop(frame.playIcon);
}

// ---------------------- LOAD FROM SUPABASE ---------------------- //
async function loadPaintingsFromSupabase(scene, imgDisplaySize) {
  if (!window.supabase) return console.warn("[RageCity] No Supabase client.");

  try {
    const { data, error } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("frame_index, storage_path, mime_type, image_url");

    if (error || !data) return console.warn("[Supabase] Load error:", error);
    if (!data.length) return console.log("[RageCity] No gallery records found.");

    const resolved = await Promise.all(
      data.map(async (row) => {
        const f = galleryFrames[row.frame_index];
        if (!f || f.locked) return null;

        if (row.storage_path) {
          const signed = await getSignedUrl(GALLERY_BUCKET, row.storage_path);
          return { idx: row.frame_index, url: signed, type: row.mime_type, storage: row.storage_path };
        }

        if (row.image_url) {
          return { idx: row.frame_index, url: row.image_url, type: row.mime_type || "" };
        }
        return null;
      })
    );

    const rows = resolved.filter(Boolean);
    rows.forEach((r) => {
      const f = galleryFrames[r.idx];
      if (!f) return;
      const isVid = isVideoFile(r.type, r.url);
      if (isVid) return;
      const texKey = `supPainting-${r.idx}-${Date.now()}`;
      f.supTexKey = texKey;
      scene.load.image(texKey, r.url);
    });

    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      rows.forEach((r) => {
        const f = galleryFrames[r.idx];
        if (!f) return;
        clearFrameMedia(f);

        if (isVideoFile(r.type, r.url)) {
          f.mediaKind = "video";
          f.mimeType = r.type;
          f.fullUrl = r.url;
          f.storagePath = r.storage;
          attachVideoMarker(scene, f);
          return;
        }

        const texKey = f.supTexKey;
        if (!texKey || !scene.textures.exists(texKey)) return;
        const img = scene.add.image(f.x, f.y, texKey).setDisplaySize(imgDisplaySize, imgDisplaySize).setDepth(10);

        f.img = img;
        f.mediaKind = "image";
        f.mimeType = r.type;
        f.fullUrl = r.url;
        f.storagePath = r.storage;
      });
    });

    scene.load.start();
  } catch (err) {
    console.error("[RageCity] Unexpected load error:", err);
  }
}

// ---------------------- REMOVE OLD PAINTING ---------------------- //
async function deleteOldPaintingFromSupabase(frameIndex) {
  if (!window.supabase) return;
  try {
    const { data } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("storage_path")
      .eq("frame_index", frameIndex)
      .single();

    if (!data?.storage_path) return;

    await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .remove([data.storage_path]);

  } catch (e) {
    console.warn("[RageCity] Delete old file failed:", e);
  }
}

// ---------------------- UPLOAD / REPLACE ---------------------- //
async function uploadPaintingToSupabase(frameIndex, file) {
  if (!window.supabase) return null;

  try {
    const mimeType = file.type || "";
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const timestamp = Date.now();
    const filePath = `paintings/painting_${frameIndex}_${timestamp}.${ext}`;

    await deleteOldPaintingFromSupabase(frameIndex);

    const { error: uploadError } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      alert("Upload error: " + uploadError.message);
      return null;
    }

    await window.supabase
      .from(PAINTINGS_TABLE)
      .upsert({ frame_index: frameIndex, storage_path: filePath, mime_type: mimeType }, { onConflict: "frame_index" });

    try {
      return await getSignedUrl(GALLERY_BUCKET, filePath);
    } catch (_) {
      return null;
    }

  } catch (err) {
    alert("Unexpected upload error: " + err.message);
    return null;
  }
}

// =================== END OF HELPERS =================== //