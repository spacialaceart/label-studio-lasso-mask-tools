import { imageEdges, magneticPath } from "./magnetic-lasso";

let edges;
let width;
let height;
self.onmessage = ({ data }) => {
  const { id } = data;
  try {
    if (data.type === "init") {
      width = data.width;
      height = data.height;
      edges = imageEdges(data.rgba, width, height);
      self.postMessage({ id, ready: true });
    } else {
      const points = magneticPath(edges, width, height, data.start, data.end, data.radius, data.sensitivity);
      self.postMessage({ id, points });
    }
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
