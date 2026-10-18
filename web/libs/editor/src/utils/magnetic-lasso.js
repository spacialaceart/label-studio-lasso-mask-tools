export function imageEdges(rgba, width, height) {
  const gray = new Float32Array(width * height);
  const edges = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] +
        gray[i - width + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + width - 1] +
        gray[i + width + 1];
      const gy =
        -gray[i - width - 1] -
        2 * gray[i - width] -
        gray[i - width + 1] +
        gray[i + width - 1] +
        2 * gray[i + width] +
        gray[i + width + 1];
      edges[i] = Math.min(1, Math.hypot(gx, gy) / 1020);
    }
  }
  return edges;
}

// A bounded live-wire search. Strong image edges have a lower traversal cost.
export function magneticPath(edges, width, height, start, end, radius = 24, sensitivity = 5) {
  const clampPoint = ([x, y]) => [
    Math.max(0, Math.min(width - 1, Math.round(x))),
    Math.max(0, Math.min(height - 1, Math.round(y))),
  ];
  const [sx, sy] = clampPoint(start);
  const [ex, ey] = clampPoint(end);
  const left = Math.max(0, Math.min(sx, ex) - radius);
  const top = Math.max(0, Math.min(sy, ey) - radius);
  const w = Math.min(width - 1, Math.max(sx, ex) + radius) - left + 1;
  const h = Math.min(height - 1, Math.max(sy, ey) + radius) - top + 1;
  const distances = new Float32Array(w * h).fill(Number.POSITIVE_INFINITY);
  const parents = new Int32Array(w * h).fill(-1);
  const visited = new Uint8Array(w * h);
  const source = (sy - top) * w + sx - left;
  const target = (ey - top) * w + ex - left;
  const heap = [];
  const push = (entry) => {
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= entry[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = entry;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
        if (last[0] <= heap[child][0]) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  distances[source] = 0;
  push([0, source]);
  const length = Math.hypot(ex - sx, ey - sy) || 1;
  while (heap.length) {
    const [, index] = pop();
    if (visited[index]) continue;
    if (index === target) break;
    visited[index] = 1;
    const x = (index % w) + left;
    const y = Math.floor(index / w) + top;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < left || nx >= left + w || ny < top || ny >= top + h) continue;
        // Keep the path in a corridor around the user's intended segment.
        if (Math.abs((nx - sx) * (ey - sy) - (ny - sy) * (ex - sx)) / length > radius) continue;
        const next = (ny - top) * w + nx - left;
        const edge = Math.min(1, edges[ny * width + nx] * sensitivity);
        const cost = distances[index] + Math.hypot(dx, dy) * (0.05 + (1 - edge) ** 2);
        if (cost < distances[next]) {
          distances[next] = cost;
          parents[next] = index;
          push([cost + 0.05 * Math.hypot(ex - nx, ey - ny), next]);
        }
      }
    }
  }
  if (source !== target && parents[target] === -1)
    throw new Error("Unable to trace this edge. Place anchors closer together.");
  const result = [];
  for (let i = target; i !== -1; i = parents[i]) result.push([(i % w) + left, Math.floor(i / w) + top]);
  return result.reverse();
}
