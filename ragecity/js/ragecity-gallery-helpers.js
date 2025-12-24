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
    s.endsWith(".m4v") ||
    s.endsWith(".ogg")
  );
}

/**
 * Create a signed URL for a private file in the RageCity bucket.
 * We keep art_private so random people can't hotlink it unchecked,
 * but we want the scene to show it without exposing your service key.
 *
 * NOTE: for security, only do this from a client that is already authenticated
 * and only for the one bucket/table you intend.
 */
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
}

/**
 * Optionally add a tiny "video" marker overlay to the frame
 * so players see it's a video, not just a static thumb.
 */
function attachVideoMarker(scene, frame, displayWidth, displayHeight) {
  if (!scene || !frame || !frame.zone) return;

  const markerSize = Math.min(displayWidth, displayHeight) * 0.15;
  const markerX = frame.zone.x + displayWidth / 2 - markerSize * 0.7;
  const markerY = frame.zone.y - displayHeight / 2 + markerSize * 0.7;

  const triangle = scene.add.triangle(
    markerX,
    markerY,
    0, -markerSize / 2,
    markerSize / 2, 0,
    0, markerSize / 2
  );
  triangle.setStrokeStyle(2, 0x00ff00, 1);
  triangle.setFillStyle(0x000000, 0.6);
  triangle.setDepth(105);

  frame.videoMarker = triangle;
}

/**
 * Load current paintings from Supabase into frames.
 *
 * The RLS policy should restrict this to the city or user you want.
 */
async function loadPaintingsFromSupabase(scene, imgDisplaySize) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase not found on window, cannot load paintings.");
    return;
  }

  console.log("[RageCity] Loading paintings from Supabase...");

  try {
    const { data, error } = await window.supabase
      .from(PAINTINGS_TABLE)
      .select("*")
      .order("frame_index", { ascending: true });

    if (error) {
      console.error("[RageCity] Error loading paintings:", error);
      return;
    }

    console.log("[RageCity] Received painting rows:", data);

    const rowsByFrame = {};
    for (const row of data) {
      if (typeof row.frame_index !== "number") continue;
      rowsByFrame[row.frame_index] = row;
    }

    Object.keys(rowsByFrame).forEach((key) => {
      const idx = parseInt(key, 10);
      if (idx < 0 || idx >= galleryFrames.length) return null;
      const frame = galleryFrames[idx];
      const row = rowsByFrame[idx];

      clearFrameMedia(frame);

      if (!row.file_path) {
        console.warn("[RageCity] Row missing file_path for frame index", idx, row);
        return;
      }

      const isVideo = isVideoFile(row.mime_type, row.file_path);
      console.log("[RageCity] frame", idx, "-> isVideo?", isVideo, row);

      getSignedUrl(GALLERY_BUCKET, row.file_path)
        .then((signedUrl) => {
          if (!signedUrl) {
            console.warn("[RageCity] No signed URL for frame index", idx, row);
            return;
          }

          frame.filePath = row.file_path;
          frame.fileType = row.mime_type;
          frame.signedUrl = signedUrl;
          frame.isVideo = isVideo;

          if (!isVideo) {
            // Image
            console.log("[RageCity] Loading image into frame", idx, signedUrl);

            const textureKey = `frame_image_${idx}_${Date.now()}`;
            scene.load.image(textureKey, signedUrl);
            scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
              if (!frame.zone) return;

              if (frame.img && frame.scene && frame.scene.textures && frame.scene.textures.exists(frame.img.texture.key)) {
                frame.img.destroy();
                frame.img = null;
              }

              const sprite = scene.add.sprite(frame.zone.x, frame.zone.y, textureKey);
              sprite.setDepth(100);
              sprite.setOrigin(0.5, 0.5);

              const originalWidth = sprite.width;
              const originalHeight = sprite.height;
              const maxWidth = imgDisplaySize;
              const maxHeight = imgDisplaySize;

              let scale = 1;
              if (originalWidth > maxWidth || originalHeight > maxHeight) {
                const scaleX = maxWidth / originalWidth;
                const scaleY = maxHeight / originalHeight;
                scale = Math.min(scaleX, scaleY);
              }
              sprite.setScale(scale);

              frame.img = sprite;
            });
            scene.load.start();
          } else {
            // Video -> hover marker only (video playback handled elsewhere if you want)
            console.log("[RageCity] Marking frame", idx, "as video.");
            attachVideoMarker(scene, frame, imgDisplaySize, imgDisplaySize);
          }
        })
        .catch((err) => {
          console.error("[RageCity] Error creating signed URL for frame index", idx, err);
        });
    });
  } catch (err) {
    console.error("[RageCity] Unexpected error loading paintings:", err);
  }
}

/**
 * Delete old painting file from Supabase (if it exists).
 * This doesn't delete DB rows; we rely on upsert to override them.
 */
async function deleteOldPaintingFromSupabase(frameIndex) {
  if (!window.supabase) {
    console.warn("[RageCity] Supabase not found on window, cannot delete old painting.");
    return;
  }

  const frame = galleryFrames[frameIndex];
  if (!frame || !frame.filePath) {
    console.log("[RageCity] No previous filePath for frame index", frameIndex, "; nothing to delete.");
    return;
  }

  try {
    console.log("[RageCity] Deleting previous file from Supabase:", {
      bucket: GALLERY_BUCKET,
      path: frame.filePath,
    });

    const { error } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .remove([frame.filePath]);

    if (error) {
      console.error("[RageCity] Error deleting old painting:", error);
    } else {
      console.log("[RageCity] Old painting deleted successfully:", frame.filePath);
    }
  } catch (err) {
    console.error("[RageCity] Unexpected error deleting old painting:", err);
  }
}

/**
 * Upload a new painting (image or video) to Supabase and record metadata.
 *
 * Steps:
 * 1) Optionally delete the old file for this frame.
 * 2) Upload the new file with a versioned name.
 * 3) Upsert metadata row in the paintings table.
 * 4) Return a signed URL so the current viewer sees it immediately.
 */
async function uploadPaintingToSupabase(frameIndex, file) {
  if (!window.supabase) {
    alert("Supabase is not available, cannot upload painting.");
    return null;
  }

  const frame = galleryFrames[frameIndex];
  if (!frame) {
    alert("Internal error: invalid frame index.");
    return null;
  }

  try {
    await deleteOldPaintingFromSupabase(frameIndex);

    const ext = (file.name.split(".").pop() || "dat").toLowerCase();
    const mimeType = file.type || (isVideoFile(null, file.name) ? "video/mp4" : "image/jpeg");

    const timestamp = Date.now();
    const fileName = `painting_${frameIndex}_${timestamp}.${ext}`;
    const filePath = `paintings/${fileName}`;

    console.log("[RageCity] Starting upload to Supabase:", {
      bucket: GALLERY_BUCKET,
      filePath,
      frameIndex,
      fileType: mimeType,
      fileSize: file.size,
    });

    const { data: uploadData, error: uploadError } = await window.supabase
      .storage
      .from(GALLERY_BUCKET)
      .upload(filePath, file, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[RageCity] Error uploading painting:", uploadError);
      alert("RageCity upload error (storage): " + uploadError.message);
      return null;
    }

    console.log("[RageCity] Storage upload success:", uploadData);

    const { data: upsertData, error: upsertError } = await window.supabase
      .from(PAINTINGS_TABLE)
      .upsert(
        {
          frame_index: frameIndex,
          file_path: filePath,
          mime_type: mimeType,
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "frame_index" }
      );

    if (upsertError) {
      console.error("[RageCity] Error upserting painting record:", upsertError);
      alert("RageCity upload error (DB upsert): " + upsertError.message);
      // still try returning a signed URL so the current user sees it
    } else {
      console.log("[RageCity] Painting DB upsert success:", upsertData);
    }

    let signedUrl = null;
    try {
      signedUrl = await getSignedUrl(GALLERY_BUCKET, filePath);
    } catch (e) {
      console.error("[RageCity] Error creating signed URL:", e);
    }

    console.log("[RageCity] Upload + DB save complete for frame", frameIndex, { signedUrl, filePath, mimeType });
    return signedUrl;
  } catch (err) {
    console.error("[RageCity] Unexpected error uploading painting:", err);
    alert("RageCity upload error (unexpected): " + err.message);
    return null;
  }
}