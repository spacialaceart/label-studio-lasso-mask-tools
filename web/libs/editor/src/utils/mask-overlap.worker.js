import { subtractMaskOverlap } from "./mask-overlap";

self.onmessage = ({ data }) => {
  try {
    const result = subtractMaskOverlap(data);
    self.postMessage(result, result.rle ? [result.rle.buffer] : []);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
