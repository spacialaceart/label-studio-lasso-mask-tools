/** Fill pixel centres using the even-odd rule, in original image coordinates. */
export function applyLassoMask(base, points, width, height, operation = "new") {
  const data = operation === "new" ? new Uint8ClampedArray(width * height * 4) : new Uint8ClampedArray(base);
  if (data.length !== width * height * 4) throw new Error("Mask dimensions do not match the image.");
  if (points.length < 3 || points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
    return { data, pixels: 0 };
  }
  let pixels = 0;
  const firstRow = Math.max(0, Math.ceil(points.reduce((min, p) => Math.min(min, p[1]), height) - 0.5));
  const lastRow = Math.min(height, Math.ceil(points.reduce((max, p) => Math.max(max, p[1]), 0) - 0.5));
  const value = operation === "subtract" ? 0 : 255;
  for (let y = firstRow; y < lastRow; y++) {
    const crossings = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[j];
      const [bx, by] = points[i];
      if (ay > y + 0.5 !== by > y + 0.5) {
        crossings.push(ax + ((y + 0.5 - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.max(0, Math.ceil(crossings[i] - 0.5));
      const right = Math.min(width, Math.ceil(crossings[i + 1] - 0.5));
      if (right <= left) continue;
      data.fill(value, (y * width + left) * 4, (y * width + right) * 4);
      pixels += right - left;
    }
  }
  return { data, pixels };
}

/** Iterative Ramer-Douglas-Peucker simplification; avoids recursion on long strokes. */
export function simplifyLasso(points, tolerance = 0.5) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const [ax, ay] = points[start];
    const dx = points[end][0] - ax;
    const dy = points[end][1] - ay;
    const length = dx * dx + dy * dy;
    let maximum = tolerance * tolerance;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const [x, y] = points[i];
      const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
      const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (distance > maximum) {
        maximum = distance;
        index = i;
      }
    }
    if (index !== -1) {
      keep.add(index);
      stack.push([start, index], [index, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
