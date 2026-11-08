import { decode, encode } from "@thi.ng/rle-pack";

export function intersectMaskBounds(a, b) {
  const bounds = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : null;
}

/** Conservative bounds in source-image pixels, including brush radius and antialiasing. */
export function maskBounds(region, width, height) {
  const full = { left: 0, top: 0, right: width, bottom: height };
  // Undo can restore RLE without updating the volatile display bbox. Only use
  // bounds tied to this exact RLE and source-image size.
  const cached = region.currentRLEBounds;
  if (region.maskDataURL || (region.rle?.length && !cached)) return full;
  let bounds = cached ? { ...cached } : null;
  for (const touch of region.touches) {
    if (touch.type === "eraser") continue;
    const points = touch.relativePoints;
    if (!points.length || !Number.isFinite(touch.relativeStrokeWidth)) return full;
    const radius = (touch.relativeStrokeWidth * width) / 200 + 1;
    for (let i = 0; i < points.length; i += 2) {
      const x = (points[i] * width) / 100;
      const y = (points[i + 1] * height) / 100;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return full;
      if (!bounds) bounds = { left: x - radius, top: y - radius, right: x + radius, bottom: y + radius };
      else {
        bounds.left = Math.min(bounds.left, x - radius);
        bounds.top = Math.min(bounds.top, y - radius);
        bounds.right = Math.max(bounds.right, x + radius);
        bounds.bottom = Math.max(bounds.bottom, y + radius);
      }
    }
  }
  if (!bounds) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.max(0, Math.floor(bounds.left)),
    top: Math.max(0, Math.floor(bounds.top)),
    right: Math.min(width, Math.ceil(bounds.right)),
    bottom: Math.min(height, Math.ceil(bounds.bottom)),
  };
}

/** Owns its buffers; callers can transfer them to a worker without extra RGBA copies. */
export function subtractMaskOverlap({ keep, target, width, height, overlap, targetBounds }) {
  const kept = keep.pixels ?? decode(keep.rle);
  const trimmed = target.pixels ?? decode(target.rle);
  if (kept.length !== width * height * 4 || trimmed.length !== kept.length)
    throw new Error("Mask dimensions do not match the image.");
  let removed = 0;
  for (let y = overlap.top; y < overlap.bottom; y++) {
    for (let x = overlap.left; x < overlap.right; x++) {
      const i = (y * width + x) * 4;
      if (kept[i + 3] && trimmed[i + 3]) {
        trimmed.fill(0, i, i + 4);
        removed++;
      }
    }
  }
  if (!removed) return { removed: 0 };

  // Normalize canvas RGB to the alpha-based RLE format and calculate the new bounds
  // in the same pass. Passing these bounds to replaceMask avoids a second decode.
  const bbox = { left: width, top: height, right: 0, bottom: 0 };
  for (let y = targetBounds.top; y < targetBounds.bottom; y++) {
    for (let x = targetBounds.left; x < targetBounds.right; x++) {
      const i = (y * width + x) * 4;
      const alpha = trimmed[i + 3];
      trimmed[i] = trimmed[i + 1] = trimmed[i + 2] = alpha;
      if (!alpha) continue;
      bbox.left = Math.min(bbox.left, x);
      bbox.top = Math.min(bbox.top, y);
      bbox.right = Math.max(bbox.right, x + 1);
      bbox.bottom = Math.max(bbox.bottom, y + 1);
    }
  }
  if (bbox.right <= bbox.left) return { removed, empty: true };
  return { removed, empty: false, bbox, rle: encode(trimmed, trimmed.length) };
}
