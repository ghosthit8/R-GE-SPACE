// --- Supabase shared gallery config ---
const GALLERY_BUCKET = "ragecity-gallery";
const PAINTINGS_TABLE = "ragecity_paintings";

// Log once when this file loads so we know if Supabase is there
console.log("[RageCity] cityScene.js loaded. Supabase present?", !!window.supabase);
// Version marker so you can verify you're loading the new file
console.log("[RageCity] CityScene.js VERSION: abxy_xy_no_actions_2025-12-16_v1");

// ===== RageCity Media Helpers (images + videos + private buckets) =====
const SIGNED_URL_EXPIRES_SECONDS = 60 * 30; // 30 minutes

function isVideoFile(mimeType, pathOrUrl) {
  const mt = (mimeType || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  const s = String(pathOrUrl || "").toLowerCase();
  return (
    s.endsWith(".mp4") ||
    s.endsWith(".webm") ||
    s.endsWith(".mov") ||
    s.endsWith(".m4v")
  );
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

  if (frame.img) {
    try { frame.img.destroy(); } catch (_) {}
    frame.img = null;
  }

  if (frame.playIcon) {
    try { frame.playIcon.destroy(); } catch (_) {}
    frame.playIcon = null;
  }

  if (frame.videoMarker) {
    try { frame.videoMarker.destroy(); } catch (_) {}
    frame.videoMarker = null;
  }

  // Remove previous local texture key (if any)
  if (
    frame.localTexKey &&
    frame.scene &&
    frame.scene.textures &&
    frame.scene.textures.exists(frame.localTexKey)
  ) {
    try { frame.scene.textures.remove(frame.localTexKey); } catch (_) {}
  }

  frame.localTexKey = null;
  frame.mediaKind = null;
  frame.mimeType = "";
}

/**
 * Simple neon play marker for VIDEO frames (no video texture preview).
 */
function attachVideoMarker(scene, frame) {
  // Simple neon play marker inside the frame (since we can't texture-preview a video reliably)
  if (frame.playIcon) {
    try { frame.playIcon.destroy(); } catch (_) {}
  }
  frame.playIcon = scene.add.text(frame.x, frame.y, "▶", {
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: "18px",
    color: "#39ff14",
  });
  frame.playIcon.setOrigin(0.5);
  frame.playIcon.setDepth(11);
  scene.children.bringToTop(frame.playIcon);
}

// ===== end helpers =====

// Load all painting media from Supabase and apply to frames
// Supports both legacy public "image_url" AND private-bucket rows saved as "storage_path" + "mime_type"
async function loadPaintingsFromSupabase(scene, imgDisplaySize) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase client missing; skipping shared gallery load.");
    return;
  }

  try {
    console.log("[RageCity] Loading paintings from Supabase table:", PAINTINGS_TABLE);

    const { data, error } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("frame_index, storage_path, mime_type, image_url");

    if (error) {
      console.error("[RageCity] Error loading paintings from Supabase:", error);
      return;
    }

    if (!data || !data.length) {
      console.log("[RageCity] No paintings found in table.");
      return;
    }

    // Resolve URLs first (signed if private bucket + storage_path, otherwise legacy public image_url)
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
            return { idx, url: signedUrl, mimeType, storagePath: row.storage_path };
          } catch (e) {
            console.error("[RageCity] Signed URL error for", row.storage_path, e);
            return null;
          }
        }

        // Legacy fallback (public URL stored in DB)
        if (row.image_url) {
          return { idx, url: row.image_url, mimeType, storagePath: null };
        }

        return null;
      })
    );

    const rows = resolved.filter(Boolean);
    if (!rows.length) return;

    // Queue image loads for non-video rows
    rows.forEach((r) => {
      const frame = galleryFrames[r.idx];
      if (!frame || frame.locked) return;

      // Keep a backref for clearFrameMedia()
      frame.scene = scene;

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
      rows.forEach((r) => {
        const frame = galleryFrames[r.idx];
        if (!frame || frame.locked) return;

        // Keep a backref for clearFrameMedia()
        frame.scene = scene;

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
        frame.mimeType = r.mimeType || "image/jpeg";
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
// ✅ OPTION A: Delete previous file in bucket before uploading
// =============================================================
async function deleteOldPaintingFromSupabase(frameIndex) {
  if (!window.supabase) return;

  try {
    const { data, error } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("storage_path")
      .eq("frame_index", frameIndex)
      .single();

    if (error || !data?.storage_path) return;

    console.log("[RageCity] Deleting old file:", data.storage_path);

    const { error: delErr } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .remove([data.storage_path]);

    if (delErr) {
      console.error("[RageCity] Error deleting old file:", delErr);
    } else {
      console.log("[RageCity] Old file deleted:", data.storage_path);
    }
  } catch (err) {
    console.error("[RageCity] Unexpected error deleting old painting:", err);
  }
}

// Upload a file to Supabase bucket + upsert DB row.
// IMPORTANT: For PRIVATE buckets, we save storage_path + mime_type (NOT a signed URL)
// and return a fresh signed URL for immediate use.
async function uploadPaintingToSupabase(frameIndex, file) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase client missing; cannot upload.");
    return null;
  }

  try {
    const mimeType = file.type || "";
    const name = file.name || "";
    const extFromName = (name.includes(".") ?
      name.split(".").pop() : "") || "";
    const extFromMime = (mimeType.includes("/") ? mimeType.split("/")[1] : "") || "";
    const ext = (extFromName || extFromMime || "bin").toLowerCase();

    // ✅ Delete previous file first (Option A)
    await deleteOldPaintingFromSupabase(frameIndex);

    // versioned filename so each replace gets a new path
    const timestamp = Date.now();
    const fileName = `painting_${frameIndex}_${timestamp}.${ext}`;
    const filePath = `paintings/${fileName}`;

    console.log("[RageCity] Starting upload to Supabase:", {
      bucket: GALLERY_BUCKET,
      filePath,
      frameIndex,
      mimeType,
      name,
      size: file.size,
    });

    const { data: uploadData, error: uploadError } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .upload(filePath, file, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[RageCity] Error uploading painting to bucket:", uploadError);
      alert("RageCity upload error (Storage): " + uploadError.message);
      return null;
    }

    console.log("[RageCity] Storage upload success:", uploadData);

    // Save DB row (private-bucket friendly)
    const { data: upsertData, error: upsertError } = await window.supabase
      .from(PAINTINGS_TABLE)
      .upsert(
        { frame_index: frameIndex, storage_path: filePath, mime_type: mimeType },
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

    console.log("[RageCity] Upload + DB save complete for frame", frameIndex, {
      signedUrl,
      filePath,
      mimeType,
    });
    return signedUrl;
  } catch (err) {
    console.error("[RageCity] Unexpected error uploading painting:", err);
    alert("RageCity upload error (unexpected): " + err.message);
    return null;
  }
}