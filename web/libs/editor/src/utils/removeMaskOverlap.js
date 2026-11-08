import { getSnapshot, isAlive } from "mobx-state-tree";
import Canvas from "./canvas";
import { intersectMaskBounds, maskBounds, subtractMaskOverlap } from "./mask-overlap";

export function maskOverlapReason(regions) {
  if (regions.length !== 2 || regions[0] === regions[1]) return "Select exactly two masks.";
  if (regions.some((r) => !isAlive(r) || r.type !== "brushregion" || r.isReadOnly() || r.hidden))
    return "Select editable, visible brush masks.";
  const first = regions[0];
  if (!first.annotation.selected || first.annotation.isReadOnly()) return "Select an editable annotation.";
  if (
    regions.some(
      (r) =>
        r.annotation !== first.annotation ||
        r.object !== first.object ||
        r.currentImageEntity !== first.currentImageEntity,
    )
  )
    return "Select masks on the same image.";
  if (first.object.multiImage && (first.item_index ?? 0) !== first.object.currentImage)
    return "Select masks on the current image.";
  if (first.annotation.isDrawing) return "Finish or cancel the current drawing first.";
  return "";
}

export function assertOverlapCurrent(prepared) {
  const { keep, target, snapshots, width, height } = prepared;
  const reason = maskOverlapReason([keep, target]);
  if (reason) throw new Error(reason);
  const selected = keep.annotation.selectedRegions;
  if (
    selected.length !== 2 ||
    !selected.includes(keep) ||
    !selected.includes(target) ||
    getSnapshot(keep) !== snapshots[0] ||
    getSnapshot(target) !== snapshots[1] ||
    keep.currentImageEntity.naturalWidth !== width ||
    keep.currentImageEntity.naturalHeight !== height
  )
    throw new Error("The selected masks changed. Try removing overlap again.");
}

async function readMask(region) {
  // Unedited RLE stays compressed on the UI thread; large masks decode in the worker.
  if (region.rle?.length && !region.touches.length && !region.maskDataURL) return { rle: region.rle };
  let bitmap = region.getMaskImage();
  if (region.maskDataURL) {
    bitmap = new window.Image();
    bitmap.src = region.maskDataURL;
    await bitmap.decode();
  }
  if (!isAlive(region)) throw new Error("The selected masks changed. Select them again.");
  const canvas = Canvas.brushRegionToCanvas(region, bitmap);
  try {
    return { pixels: canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function runWorker(data, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mask-overlap.worker.js", import.meta.url), { type: "module" });
    const finish = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new Error("Overlap removal cancelled."));
    const timer = setTimeout(() => finish(new Error("Overlap removal timed out. Try smaller masks.")), 120000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data: result }) => finish(result.error ? new Error(result.error) : null, result);
    worker.onerror = () => finish(new Error("Could not process the masks."));
    try {
      worker.postMessage(data, [data.keep.pixels?.buffer, data.target.pixels?.buffer].filter(Boolean));
    } catch (error) {
      finish(error);
    }
  });
}

export async function prepareOverlapRemoval(keep, target, signal) {
  const reason = maskOverlapReason([keep, target]);
  if (reason) throw new Error(reason);
  const { naturalWidth: width, naturalHeight: height } = keep.currentImageEntity;
  if (!(width > 1 && height > 1)) throw new Error("Wait for the image to load.");
  const prepared = { keep, target, width, height, snapshots: [getSnapshot(keep), getSnapshot(target)] };
  assertOverlapCurrent(prepared);
  const targetBounds = maskBounds(target, width, height);
  const overlap = intersectMaskBounds(maskBounds(keep, width, height), targetBounds);
  if (!overlap) return { ...prepared, removed: 0 };
  const check = () => {
    if (signal?.aborted) throw new Error("Overlap removal cancelled.");
    assertOverlapCurrent(prepared);
  };
  check();
  const keepMask = await readMask(keep);
  check();
  const targetMask = await readMask(target);
  check();
  const data = { keep: keepMask, target: targetMask, width, height, overlap, targetBounds };
  const result = width * height >= 1_000_000 ? await runWorker(data, signal) : subtractMaskOverlap(data);
  check();
  return { ...prepared, ...result };
}
