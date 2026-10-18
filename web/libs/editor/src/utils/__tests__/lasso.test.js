import { describe, expect, it } from "bun:test";
import { applyLassoMask, simplifyLasso } from "../lasso";
import { imageEdges, magneticPath } from "../magnetic-lasso";

const alpha = (data, width, x, y) => data[(y * width + x) * 4 + 3];
describe("lasso mask composition", () => {
  it("fills exactly the selected pixel centres and clips to image bounds", () => {
    const { data, pixels } = applyLassoMask(
      null,
      [
        [-4, -4],
        [3, -4],
        [3, 3],
        [-4, 3],
      ],
      8,
      8,
    );
    expect(pixels).toBe(9);
    expect(alpha(data, 8, 2, 2)).toBe(255);
    expect(alpha(data, 8, 3, 3)).toBe(0);
  });
  it("supports concavity and self intersections using even-odd fill", () => {
    const concave = applyLassoMask(
      null,
      [
        [0, 0],
        [6, 0],
        [6, 2],
        [2, 2],
        [2, 6],
        [0, 6],
      ],
      8,
      8,
    );
    expect(concave.pixels).toBe(20);
    expect(alpha(concave.data, 8, 4, 4)).toBe(0);
    expect(
      applyLassoMask(
        null,
        [
          [0, 0],
          [6, 6],
          [0, 6],
          [6, 0],
        ],
        8,
        8,
      ).pixels,
    ).toBeGreaterThan(0);
  });
  it("adds disconnected islands and subtracts holes without changing unrelated pixels", () => {
    const original = applyLassoMask(
      null,
      [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      8,
      8,
    ).data;
    const added = applyLassoMask(
      original,
      [
        [6, 6],
        [8, 6],
        [8, 8],
        [6, 8],
      ],
      8,
      8,
      "add",
    ).data;
    const cut = applyLassoMask(
      added,
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      8,
      8,
      "subtract",
    ).data;
    expect(alpha(cut, 8, 2, 2)).toBe(0);
    expect(alpha(cut, 8, 0, 0)).toBe(255);
    expect(alpha(cut, 8, 7, 7)).toBe(255);
    expect(alpha(original, 8, 2, 2)).toBe(255);
  });
  it("rejects degenerate and nonfinite paths", () => {
    for (const points of [
      [],
      [
        [0, 0],
        [1, 1],
      ],
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      [
        [0, 0],
        [2, 2],
        [Number.NaN, 3],
      ],
    ]) {
      expect(applyLassoMask(null, points, 8, 8).pixels).toBe(0);
    }
  });
  it("preserves freehand corners while reducing straight segments", () => {
    expect(
      simplifyLasso(
        [
          [0, 0],
          [1, 0.1],
          [2, 0],
          [2, 1],
          [2, 2],
        ],
        0.2,
      ),
    ).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
    ]);
  });
});

describe("magnetic edge tracing", () => {
  it("follows a nearby image boundary instead of a straight pointer segment", () => {
    const width = 100;
    const rgba = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < width; y++) {
      for (let x = 80; x < width; x++) rgba.fill(255, (y * width + x) * 4, (y * width + x + 1) * 4);
    }
    const edges = imageEdges(rgba, width, width);
    const path = magneticPath(edges, width, width, [75, 5], [75, 90], 12, 5);
    expect(path[0]).toEqual([75, 5]);
    expect(path.at(-1)).toEqual([75, 90]);
    expect(path.filter(([x, y]) => x >= 79 && y > 15 && y < 80).length).toBeGreaterThan(50);
  });
  it("handles flat images, equal endpoints, and border anchors", () => {
    const edges = new Float32Array(100);
    expect(magneticPath(edges, 10, 10, [3, 3], [3, 3])).toEqual([[3, 3]]);
    const path = magneticPath(edges, 10, 10, [-2, -2], [20, 20]);
    expect(path[0]).toEqual([0, 0]);
    expect(path.at(-1)).toEqual([9, 9]);
    expect(path).toHaveLength(10);
  });
});
