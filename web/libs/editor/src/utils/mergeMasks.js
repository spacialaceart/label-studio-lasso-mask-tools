import { getSnapshot, isAlive } from "mobx-state-tree";
import { encode } from "@thi.ng/rle-pack";
import Canvas from "./canvas";

const metadata = (region) => JSON.stringify(region.results.map((result) => ({
  control: result.from_name.name,
  value: result.value,
})).sort((a, b) => a.control.localeCompare(b.control)));

export function mergeMasksReason(regions) {
  if (regions.length < 2) return "Select at least two masks.";
  if (regions.some((r) => !isAlive(r) || r.type !== "brushregion" || r.isReadOnly() || r.hidden))
    return "Select editable, visible brush masks.";
  const first = regions[0];
  if (first.annotation.isReadOnly()) return "This annotation is read-only.";
  if (regions.some((r) => r.parent !== first.parent || r.currentImageEntity !== first.currentImageEntity))
    return "Select masks on the same image.";
  if (regions.some((r) => metadata(r) !== metadata(first)))
    return "Select masks with matching labels and region properties.";
  if (first.annotation.isDrawing) return "Finish or cancel the current drawing first.";
  return "";
}

export async function prepareMaskMerge(regions) {
  const reason = mergeMasksReason(regions);
  if (reason) throw new Error(reason);
  const snapshots = regions.map((r) => getSnapshot(r));
  const { naturalWidth: width, naturalHeight: height } = regions[0].currentImageEntity;
  if (!(width > 1 && height > 1)) throw new Error("Wait for the image to load.");
  const merged = new Uint8ClampedArray(width * height * 4);
  for (const region of regions) {
    let bitmap = region.getMaskImage();
    if (region.maskDataURL) {
      bitmap = new window.Image();
      bitmap.src = region.maskDataURL;
      await bitmap.decode();
    }
    if (!isAlive(region)) throw new Error("The selected masks changed. Select them again.");
    const pixels = Canvas.brushRegionToCanvas(region, bitmap).getContext("2d").getImageData(0, 0, width, height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = Math.max(merged[i + 3], pixels[i + 3]);
      merged.fill(alpha, i, i + 4);
    }
  }
  if (mergeMasksReason(regions) || regions.some((r, i) => getSnapshot(r) !== snapshots[i]))
    throw new Error("The selected masks changed. Try merging again.");
  return Array.from(encode(merged, merged.length));
}
