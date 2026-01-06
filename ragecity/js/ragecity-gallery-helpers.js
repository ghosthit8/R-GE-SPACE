// ragecity-gallery-helpers.js
// Extracted from cityScene.js so the scene file is smaller.

// --- Supabase shared gallery config ---
const GALLERY_BUCKET = "ragecity-gallery";
const PAINTINGS_TABLE = "ragecity_paintings";

// Log once when this file loads so we know if Supabase is there
console.log("[RageCity] gallery helpers loaded. Supabase present?", !!window.supabase);
// Version marker so you can verify you're loading the new file
console.log("[RageCity] Gallery Helpers VERSION: title_desc_persist_2026-01-05_v1");

// ===== RageCity Media Helpers (images + videos + private buckets) =====
const SIGNED_URL_EXPIRES_SECONDS = 60 * 30; // 30 minutes

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

// =============================================================
// Frame cleanup helpers
// =============================================================
function clearFrameMedia(frame) {
  if (!frame) return;

  // Remove old image sprite
  if (frame.img && frame.img.destroy) {
    try { frame.img.destroy(); } catch (_) {}
  }
  frame.img = null;

  // Remove old play icon if it exists
  if (frame.playIcon && frame.playIcon.destroy) {
    try { frame.playIcon.destroy(); } catch (_) {}
  }
  frame.playIcon = null;

  // Remove any old textures we created
  if (frame.scene && frame.scene.textures) {
    try {
      if (frame.localTexKey && frame.scene.textures.exists(frame.localTexKey)) {
        frame.scene.textures.remove(frame.localTexKey);
      }
      if (frame.supTexKey && frame.scene.textures.exists(frame.supTexKey)) {
        frame.scene.textures.remove(frame.supTexKey);
      }
    } catch (_) {}
  }

  frame.localTexKey = null;
  frame.supTexKey = null;

  // Keep fullUrl/storagePath/mimeType; those are your current record
}

// Video marker for thumbnails
function attachVideoMarker(scene, frame) {
  if (!scene || !frame) return;

  // remove existing marker first
  if (frame.playIcon && frame.playIcon.destroy) {
    try { frame.playIcon.destroy(); } catch (_) {}
  }

  const g = scene.add.graphics();
  g.lineStyle(2, 0x39ff14, 1);
  g.fillStyle(0x000000, 0.55);

  const radius = 12;
  g.fillCircle(frame.x, frame.y, radius);
  g.strokeCircle(frame.x, frame.y, radius);

  // Play triangle
  g.fillStyle(0x39ff14, 0.95);
  g.beginPath();
  g.moveTo(frame.x - 4, frame.y - 6);
  g.lineTo(frame.x - 4, frame.y + 6);
  g.lineTo(frame.x + 7, frame.y);
  g.closePath();
  g.fillPath();

  g.setDepth(11);

  // store as playIcon so clearFrameMedia() removes it
  frame.playIcon = g;
}

// =============================================================
// Load all paintings/videos from Supabase table into frames
// =============================================================
async function loadPaintingsFromSupabase(scene, imgDisplaySize) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase client missing; skipping shared gallery load.");
    return;
  }

  try {
    console.log("[RageCity] Loading paintings from Supabase table:", PAINTINGS_TABLE);

    // ✅ NEW: also load title + description
    const { data, error } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("frame_index, storage_path, mime_type, image_url, title, description");

    if (error) {
      console.error("[RageCity] Error loading paintings from Supabase:", error);
      return;
    }

    if (!data || !data.length) {
      console.log("[RageCity] No paintings found in table.");
      return;
    }

    // Resolve each row into a usable URL (signed URL when storage_path exists)
    const resolved = await Promise.all(
      data.map(async (row) => {
        const idx = row.frame_index;
        if (idx < 0 || idx >= galleryFrames.length) return null;

        const frame = galleryFrames[idx];
        if (!frame || frame.locked) return null;

        const mimeType = row.mime_type || "";

        // Prefer storage_path when present (private bucket compatible)
        if (row.storage_path) {
          try {
            const signedUrl = await getSignedUrl(GALLERY_BUCKET, row.storage_path);
            return {
              idx,
              url: signedUrl,
              mimeType,
              storagePath: row.storage_path,
              title: row.title || "",
              description: row.description || ""
            };
          } catch (e) {
            console.warn("[RageCity] Failed to sign URL for", row.storage_path, e);
            return {
              idx,
              url: null,
              mimeType,
              storagePath: row.storage_path,
              title: row.title || "",
              description: row.description || ""
            };
          }
        }

        // Legacy support (public buckets / old schema)
        if (row.image_url) {
          return {
            idx,
            url: row.image_url,
            mimeType,
            storagePath: null,
            title: row.title || "",
            description: row.description || ""
          };
        }

        return {
          idx,
          url: null,
          mimeType,
          storagePath: null,
          title: row.title || "",
          description: row.description || ""
        };
      })
    );

    const rows = resolved.filter(Boolean).filter((r) => !!r.url);
    if (!rows.length) return;

    // Queue image loads; videos don't go through the loader
    rows.forEach((r) => {
      const frame = galleryFrames[r.idx];
      if (!frame || frame.locked) return;

      const isVid = isVideoFile(r.mimeType, r.url);
      if (isVid) return;

      const texKey = `supPainting-${r.idx}-${Date.now()}`;
      frame.supTexKey = texKey;

      console.log(
        `[RageCity] Queueing image load for frame ${r.idx}:`,
        r.url,
        "→ texture key:",
        texKey
      );
      scene.load.image(texKey, r.url);
    });

    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      console.log("[RageCity] Supabase media load COMPLETE event fired.");

      rows.forEach((r) => {
        const frame = galleryFrames[r.idx];
        if (!frame || frame.locked) return;

        // Keep a backref for clearFrameMedia()
        frame.scene = scene;

        // ✅ NEW: apply persisted metadata
        frame.title = (r.title || "").toString();
        frame.description = (r.description || "").toString();

        const isVid = isVideoFile(r.mimeType, r.url);

        clearFrameMedia(frame);

        if (isVid) {
          frame.mediaKind = "video";
          frame.mimeType = r.mimeType || "video/mp4";
          frame.fullUrl = r.url;        // signed or legacy url
          frame.storagePath = r.storagePath || null;

          attachVideoMarker(scene, frame);
          console.log("[RageCity] Applied VIDEO to frame", r.idx, r.url);
          return;
        }

        const texKey = frame.supTexKey;
        if (!texKey || !scene.textures.exists(texKey)) {
          console.warn("[RageCity] Texture key missing for frame", r.idx, texKey);
          return;
        }

        const img = scene.add.image(frame.x, frame.y, texKey);
        img.setDisplaySize(imgDisplaySize, imgDisplaySize);
        img.setDepth(10);

        frame.img = img;
        frame.mediaKind = "image";
        frame.mimeType = r.mimeType || "image";
        frame.fullUrl = r.url;
        frame.storagePath = r.storagePath || null;

        console.log("[RageCity] Applied IMAGE to frame", r.idx, r.url);
      });
    });

    scene.load.start();
  } catch (err) {
    console.error("[RageCity] Unexpected error loading paintings:", err);
  }
}

// =============================================================
// ✅ OPTION A: Delete previous file in bucket before uploading new
// =============================================================
async function deleteOldPaintingFromSupabase(frameIndex) {
  if (!window.supabase) return;

  try {
    const { data, error } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("storage_path")
      .eq("frame_index", frameIndex)
      .maybeSingle();

    if (error) {
      console.warn("[RageCity] Failed to look up old painting record:", error);
      return;
    }

    if (!data || !data.storage_path) return;

    const { error: delErr } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .remove([data.storage_path]);

    if (delErr) {
      console.warn("[RageCity] Failed to delete old file:", delErr);
    }
  } catch (e) {
    console.warn("[RageCity] deleteOldPaintingFromSupabase exception:", e);
  }
}

// Upload a file to Supabase bucket + upsert DB row.
// IMPORTANT: For PRIVATE buckets, we save storage_path + mime_type,
// and we return a fresh signed URL for immediate use.
async function uploadPaintingToSupabase(frameIndex, file, meta = {}) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase client missing; cannot upload.");
    return null;
  }

  try {
    const mimeType = file.type || "";
    const name = file.name || "";
    const extFromName = (name.includes(".") ? name.split(".").pop() : "") || "";
    const extFromMime = (mimeType.includes("/") ? mimeType.split("/")[1] : "") || "";
    const ext = (extFromName || extFromMime || "bin").toLowerCase();

    // ✅ NEW: optional metadata to persist
    const title = (meta && meta.title != null) ? String(meta.title).trim() : "";
    const description = (meta && meta.description != null) ? String(meta.description).trim() : "";

    // ✅ Delete previous file first (Option A)
    await deleteOldPaintingFromSupabase(frameIndex);

    const filePath = `frame_${frameIndex}.${Date.now()}.${ext}`;

    // Upload file to storage
    const { data: uploadData, error: uploadError } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: mimeType || undefined
      });

    if (uploadError) {
      console.error("[RageCity] Error uploading file to storage:", uploadError);
      alert("RageCity upload error (Storage): " + uploadError.message);
      return null;
    }

    console.log("[RageCity] Storage upload success:", uploadData);

    // Upsert row in DB (store storage_path; signed URLs expire so do NOT store them)
    const { data: upsertData, error: upsertError } = await window.supabase
      .from(PAINTINGS_TABLE)
      .upsert(
        { frame_index: frameIndex, storage_path: filePath, mime_type: mimeType, title, description },
        { onConflict: "frame_index" }
      );

    if (upsertError) {
      console.error("[RageCity] Error upserting painting record:", upsertError);
      alert("RageCity upload error (DB upsert): " + upsertError.message);
      // still try returning a signed URL so the current user sees it
    } else {
      console.log("[RageCity] Painting DB upsert success:", upsertData);
    }

    // Return a signed URL for immediate display (do NOT store this in DB; it expires)
    let signedUrl = null;
    try {
      signedUrl = await getSignedUrl(GALLERY_BUCKET, filePath);
    } catch (e) {
      console.error("[RageCity] Error creating signed URL:", e);
    }

    console.log("[RageCity] Upload + DB save complete for frame", frameIndex, { signedUrl, filePath, mimeType, title, description });
    return signedUrl;
  } catch (err) {
    console.error("[RageCity] Unexpected error uploading painting:", err);
    alert("RageCity upload error: " + (err?.message || err));
    return null;
  }
}

// Expose helpers globally so CityScene can call them
window.isVideoFile = window.isVideoFile || isVideoFile;
window.clearFrameMedia = window.clearFrameMedia || clearFrameMedia;
window.attachVideoMarker = window.attachVideoMarker || attachVideoMarker;
window.loadPaintingsFromSupabase = window.loadPaintingsFromSupabase || loadPaintingsFromSupabase;
window.uploadPaintingToSupabase = window.uploadPaintingToSupabase || uploadPaintingToSupabase;