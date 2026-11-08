import { describe, expect, it } from "bun:test";
import { decode, encode } from "@thi.ng/rle-pack";
import { intersectMaskBounds, maskBounds, subtractMaskOverlap } from "../mask-overlap";

const width = 8;
const height = 6;
const full = { left: 0, top: 0, right: width, bottom: height };
const bitmap = (points) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha = 255] of points) data.fill(alpha, (y * width + x) * 4, (y * width + x) * 4 + 4);
  return data;
};
const subtract = (keep, target, overlap = full) =>
  subtractMaskOverlap({ keep, target, width, height, overlap, targetBounds: full });

describe("exact mask overlap subtraction", () => {
  it("clears only shared pixels, preserves other islands/alpha, and leaves the keeper intact", () => {
    const kept = bitmap([
      [1, 1],
      [2, 1, 1],
      [7, 5],
    ]);
    const before = kept.slice();
    const target = bitmap([
      [1, 1],
      [2, 1, 128],
      [4, 3, 128],
      [5, 4],
    ]);
    const result = subtract({ pixels: kept }, { pixels: target });
    expect(result.removed).toBe(2);
    expect(result.bbox).toEqual({ left: 4, top: 3, right: 6, bottom: 5 });
    expect(decode(result.rle)).toEqual(
      new Uint8Array(
        bitmap([
          [4, 3, 128],
          [5, 4],
        ]),
      ),
    );
    expect(kept).toEqual(before);
  });

  it("supports compressed masks in either subtraction direction", () => {
    const a = {
      rle: encode(
        bitmap([
          [1, 1],
          [2, 2],
        ]),
        width * height * 4,
      ),
    };
    const b = {
      rle: encode(
        bitmap([
          [1, 1],
          [6, 4],
        ]),
        width * height * 4,
      ),
    };
    expect(decode(subtract(a, b).rle)).toEqual(new Uint8Array(bitmap([[6, 4]])));
    expect(decode(subtract(b, a).rle)).toEqual(new Uint8Array(bitmap([[2, 2]])));
  });

  it("does not encode or change the target when bounds overlap but painted pixels do not", () => {
    const target = bitmap([[2, 2]]);
    const before = target.slice();
    expect(subtract({ pixels: bitmap([[3, 2]]) }, { pixels: target })).toEqual({ removed: 0 });
    expect(target).toEqual(before);
  });

  it("reports complete coverage without encoding an empty mask", () => {
    expect(subtract({ pixels: bitmap([[2, 2]]) }, { pixels: bitmap([[2, 2]]) })).toEqual({ removed: 1, empty: true });
  });

  it("rejects masks with the wrong image dimensions", () => {
    expect(() => subtract({ pixels: new Uint8Array(4) }, { pixels: bitmap([]) })).toThrow("dimensions");
  });
});

describe("source image mask bounds", () => {
  it("skips separated and edge-touching bounds", () => {
    expect(
      intersectMaskBounds({ left: 0, top: 0, right: 2, bottom: 2 }, { left: 2, top: 0, right: 4, bottom: 2 }),
    ).toBeNull();
    expect(intersectMaskBounds(full, { left: 3, top: 2, right: 20, bottom: 10 })).toEqual({
      left: 3,
      top: 2,
      right: 8,
      bottom: 6,
    });
  });

  it("includes the full brush radius beyond cached RLE bounds and ignores eraser expansion", () => {
    const bounds = maskBounds(
      {
        rle: [1],
        currentRLEBounds: { left: 30, top: 30, right: 40, bottom: 40 },
        touches: [
          { type: "add", relativePoints: [50, 50], relativeStrokeWidth: 10 },
          { type: "eraser", relativePoints: [90, 90], relativeStrokeWidth: 50 },
        ],
      },
      200,
      100,
    );
    expect(bounds).toEqual({ left: 30, top: 30, right: 111, bottom: 61 });
  });

  it("uses full bounds when an edited bitmap has no trustworthy cached bounds", () => {
    expect(maskBounds({ maskDataURL: "data:image/png", touches: [] }, width, height)).toEqual(full);
    expect(maskBounds({ rle: [1], rleBbox: null, touches: [] }, width, height)).toEqual(full);
  });
});
