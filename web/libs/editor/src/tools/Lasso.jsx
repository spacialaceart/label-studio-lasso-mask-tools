import { observer } from "mobx-react";
import { reaction } from "mobx";
import { flow, isAlive, types } from "mobx-state-tree";
import { encode } from "@thi.ng/rle-pack";
import BaseTool from "./Base";
import ToolMixin from "../mixins/Tool";
import { Tool } from "../components/Toolbar/Tool";
import Canvas from "../utils/canvas";
import { applyLassoMask, simplifyLasso, smoothLasso } from "../utils/lasso";

const names = { polygonal: "Polygonal lasso", freehand: "Freehand lasso", magnetic: "Magnetic lasso" };
const LassoIcon = ({ kind }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    {kind === "polygonal" ? (
      <path d="M4 19V9l8-6 8 7-4 9Z" strokeDasharray="3 2" />
    ) : (
      <path d="M5 17C0 11 6 3 12 4s11 6 7 11-10 7-13 3 1-6 4-3-1 7-4 7" strokeDasharray="3 2" />
    )}
    {kind === "magnetic" && <path d="M10 6v5a3 3 0 0 0 6 0V6m-6 3h2m2 0h2" strokeWidth="2.5" />}
  </svg>
);
const LassoButton = observer(({ item }) => (
  <Tool
    ariaLabel={`${item.kind}-lasso`}
    label={item.title}
    active={item.selected}
    icon={<LassoIcon kind={item.kind} />}
    tool={item}
    onClick={() => {
      if (!item.selected) item.manager.selectTool(item, true);
    }}
  />
));

const LassoModel = types
  .model("Lasso", {
    group: "segmentation",
    isDrawingTool: true,
    unselectRegionOnToolChange: false,
    kind: types.enumeration(["polygonal", "freehand", "magnetic"]),
    operation: types.optional(types.enumeration(["new", "add", "subtract"]), "new"),
    searchRadius: 24,
    sensitivity: 5,
  })
  .volatile(() => ({
    isLasso: true,
    canInteractWithRegions: false,
    points: [],
    preview: [],
    anchors: [],
    mode: "viewing",
    error: "",
    busy: false,
    magneticReady: false,
  }))
  .views((self) => ({
    get title() {
      return names[self.kind];
    },
    get isDrawing() {
      return self.mode === "drawing";
    },
    get viewClass() {
      return () => <LassoButton item={self} />;
    },
    get tagTypes() {
      return { stateTypes: "brushlabels", controlTagTypes: ["brush", "brushlabels"] };
    },
    get editableMask() {
      const selected = self.annotation?.selectedRegions ?? [];
      if (selected.length !== 1) return null;
      const region = selected[0];
      return region.type === "brushregion" &&
        region.object === self.obj &&
        !region.hidden &&
        !region.isReadOnly() &&
        (!self.obj.multiImage || region.item_index === self.obj.currentImage) &&
        region.results.some((result) => result.from_name === self.control)
        ? region
        : null;
    },
  }))
  .actions((self) => {
    let draftAnnotation;
    let target;
    let generation = 0;
    let lastClick = { time: -1000, point: [0, 0] };
    let closedAt = -1000;
    let closedPoint = [0, 0];
    let disposeContext;
    let worker;
    let workerSize;
    let requestId = 0;
    let previewBusy = false;
    const pending = new Map();
    const keyListener = (event) => self.handleKey(event);
    const screenDistance = (a, b) =>
      Math.hypot(
        ((a[0] - b[0]) * self.obj.stageWidth * self.obj.zoomScale) / 100,
        ((a[1] - b[1]) * self.obj.stageHeight * self.obj.zoomScale) / 100,
      );
    const clamp = ([x, y]) => [Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y))];
    const request = (data, transfer = []) =>
      new Promise((resolve, reject) => {
        const id = ++requestId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Edge tracing timed out. Place anchors closer together."));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ ...data, id }, transfer);
      });
    const stopWorker = () => {
      worker?.terminate();
      worker = null;
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error("Selection canceled."));
      }
      pending.clear();
      previewBusy = false;
    };
    const segment = async (start, end) => {
      const [w, h] = workerSize;
      const result = await request({
        type: "path",
        start: [(start[0] * w) / 100, (start[1] * h) / 100],
        end: [(end[0] * w) / 100, (end[1] * h) / 100],
        radius: self.searchRadius,
        sensitivity: self.sensitivity,
      });
      const points = result.points.map(([x, y]) => [(x * 100) / w, (y * 100) / h]);
      if (points.length < 2) return [start, end];
      points[0] = start;
      points[points.length - 1] = end;
      return points;
    };
    return {
      shouldSkipInteractions() {
        return true;
      },
      setOperation(operation) {
        if (!self.isDrawing) {
          self.operation = operation;
          self.error = "";
        }
      },
      setSearchRadius(value) {
        self.searchRadius = Math.max(4, Math.min(80, Math.round(value)));
      },
      setSensitivity(value) {
        self.sensitivity = Math.max(1, Math.min(10, value));
      },
      afterUpdateSelected() {
        document.removeEventListener("keydown", keyListener, true);
        disposeContext?.();
        if (self.selected) {
          document.addEventListener("keydown", keyListener, true);
          disposeContext = reaction(
            () => [self.annotation, self.obj?.currentImage, self.obj?.currentSrc],
            () => self.cancelDrawing(),
          );
          if (self.obj?.stageRef) self.obj.stageRef.container().style.cursor = "crosshair";
        } else self.cancelDrawing();
      },
      handleToolSwitch(tool) {
        if (tool !== self) self.cancelDrawing();
      },
      resetBeforeAnnotationSwitch() {
        self.cancelDrawing();
      },
      beforeDestroy() {
        document.removeEventListener("keydown", keyListener, true);
        disposeContext?.();
        self.cancelDrawing();
      },
      cancelDrawing() {
        generation++;
        stopWorker();
        if (draftAnnotation && isAlive(draftAnnotation)) draftAnnotation.setIsDrawing(false);
        draftAnnotation = null;
        target = null;
        self.points = [];
        self.preview = [];
        self.anchors = [];
        self.mode = "viewing";
        self.busy = false;
        self.magneticReady = false;
        self.error = "";
      },
      begin(point) {
        if (self.disabled || self.annotation.isReadOnly() || self.annotation.isDrawing) return false;
        if (self.operation !== "new" && !self.editableMask) {
          self.error = "Select one editable mask for this brush label before using Add or Subtract.";
          return false;
        }
        if (
          self.operation === "new" &&
          (!self.obj.checkLabels() || (self.control.type === "brushlabels" && !self.control.isSelected))
        ) {
          self.error = "Choose a label before drawing a new mask.";
          return false;
        }
        self.error = "";
        draftAnnotation = self.annotation;
        target = self.operation === "new" ? null : self.editableMask;
        self.points = [point];
        self.anchors = [1];
        self.mode = "drawing";
        draftAnnotation.setIsDrawing(true);
        if (self.kind === "magnetic") self.prepareMagnetic();
        return true;
      },
      prepareMagnetic: flow(function* () {
        const version = generation;
        self.busy = true;
        try {
          const image = self.obj.imageRef;
          if (!image?.complete || !image.naturalWidth) throw new Error("Wait for the image to finish loading.");
          const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          let rgba;
          try {
            rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          } catch {
            throw new Error(
              "Magnetic lasso needs access to image pixels. Enable CORS on the image source, or use polygonal/freehand lasso.",
            );
          }
          workerSize = [canvas.width, canvas.height];
          worker = new Worker(new URL("../utils/magnetic-lasso.worker.js", import.meta.url), { type: "module" });
          worker.onmessage = ({ data }) => {
            const job = pending.get(data.id);
            if (!job) return;
            pending.delete(data.id);
            clearTimeout(job.timer);
            if (data.error) job.reject(new Error(data.error));
            else job.resolve(data);
          };
          worker.onerror = () => {
            for (const job of pending.values()) {
              clearTimeout(job.timer);
              job.reject(new Error("Magnetic edge tracing could not start."));
            }
            pending.clear();
          };
          yield request({ type: "init", rgba, width: canvas.width, height: canvas.height }, [rgba.buffer]);
          if (version === generation) self.magneticReady = true;
        } catch (error) {
          if (version === generation) {
            self.cancelDrawing();
            self.error = error.message;
          }
        } finally {
          if (version === generation) self.busy = false;
        }
      }),
      undoPoint() {
        if (self.busy) return;
        if (self.anchors.length <= 1) {
          self.cancelDrawing();
          return;
        }
        self.anchors = self.anchors.slice(0, -1);
        self.points = self.points.slice(0, self.anchors[self.anchors.length - 1]);
        self.preview = [];
      },
      handleKey(event) {
        if (!self.isDrawing || event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        const key = event.key.toLowerCase();
        const redo = key === "z" && event.shiftKey && (event.ctrlKey || event.metaKey);
        const undo = key === "backspace" || (key === "z" && !redo && (event.shiftKey || event.ctrlKey || event.metaKey));
        if (!["escape", "enter"].includes(key) && !undo && !redo) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === "escape") self.cancelDrawing();
        else if (key === "enter") self.finishDrawing();
        else if (undo) self.undoPoint();
      },
      mousedownEv(event, coords) {
        if (event.button !== 0 || event.shiftKey || self.busy) return;
        const point = clamp(coords);
        const time = performance.now();
        if (!self.isDrawing) {
          if (
            coords[0] < 0 ||
            coords[0] > 100 ||
            coords[1] < 0 ||
            coords[1] > 100 ||
            (time - closedAt < 300 && screenDistance(point, closedPoint) < 5)
          )
            return;
          self.begin(point);
        } else if (self.kind !== "freehand") {
          const close = screenDistance(point, self.points[0]) < 7;
          const double = time - lastClick.time < 350 && screenDistance(point, lastClick.point) < 5;
          if (self.anchors.length >= 3 && (close || double)) {
            closedAt = time;
            closedPoint = point;
            self.finishDrawing();
          } else if (screenDistance(point, self.points[self.points.length - 1]) > 1) {
            if (self.kind === "magnetic") self.addMagneticAnchor(point);
            else {
              self.points = [...self.points, point];
              self.anchors = [...self.anchors, self.points.length];
              self.preview = [];
            }
          }
        } else {
          // A zero-area freehand stroke can be retried with a fresh drag.
          self.cancelDrawing();
          self.begin(point);
        }
        lastClick = { time, point };
      },
      mousemoveEv(event, coords) {
        if (!self.isDrawing || self.busy || event.buttons === 4 || event.shiftKey) return;
        const point = clamp(coords);
        if (self.kind === "freehand") {
          if (!(event.buttons & 1)) return;
          if (screenDistance(point, self.points[self.points.length - 1]) >= 2) self.points = [...self.points, point];
        } else if (self.kind === "magnetic") {
          if (!self.magneticReady) return;
          if (event.buttons === 1 && screenDistance(point, self.points[self.points.length - 1]) >= 30)
            self.addMagneticAnchor(point);
          else self.updateMagneticPreview(point);
        } else self.preview = [point];
      },
      mouseupEv(event, coords) {
        if (event.button !== 0 || !self.isDrawing || self.kind !== "freehand") return;
        self.points = [...self.points, clamp(coords)];
        self.finishDrawing();
      },
      updateMagneticPreview: flow(function* (point) {
        if (previewBusy || !self.magneticReady) return;
        previewBusy = true;
        const version = generation;
        const start = self.points[self.points.length - 1];
        try {
          const path = yield segment(start, point);
          if (version === generation && start === self.points[self.points.length - 1]) self.preview = path.slice(1);
        } catch (error) {
          if (version === generation) self.error = error.message;
        } finally {
          previewBusy = false;
        }
      }),
      addMagneticAnchor: flow(function* (point) {
        if (!self.magneticReady || self.busy) return;
        const version = generation;
        self.busy = true;
        try {
          const path = yield segment(self.points[self.points.length - 1], point);
          if (version !== generation) return;
          self.points = [...self.points, ...path.slice(1)];
          self.anchors = [...self.anchors, self.points.length];
          self.preview = [];
        } catch (error) {
          if (version === generation) self.error = error.message;
        } finally {
          if (version === generation) self.busy = false;
        }
      }),
      finishDrawing: flow(function* () {
        if (!self.isDrawing || self.busy) return;
        if (self.points.length < 3) {
          self.error = "Draw an enclosed area with at least three points.";
          return;
        }
        const version = generation;
        const annotation = draftAnnotation;
        const region = target;
        const object = self.obj;
        self.busy = true;
        try {
          let points = self.points;
          if (self.kind === "magnetic") {
            const closing = yield segment(points[points.length - 1], points[0]);
            if (version !== generation) return;
            points = [...points, ...closing.slice(1)];
          }
          const { naturalWidth: width, naturalHeight: height } = object.currentImageEntity;
          points = points.map(([x, y]) => [(x * width) / 100, (y * height) / 100]);
          if (self.kind === "freehand") points = simplifyLasso(points, 0.5);
          // Edge paths step one analysis pixel at a time; drop the steps, then round the outline.
          if (self.kind === "magnetic")
            points = smoothLasso(simplifyLasso(points, Math.max(1, width / (workerSize?.[0] || width))));
          let base;
          if (region) {
            let bitmap = region.getMaskImage();
            if (region.maskDataURL) {
              bitmap = new window.Image();
              bitmap.src = region.maskDataURL;
              yield bitmap.decode();
            }
            if (version !== generation || !isAlive(region)) return;
            base = Canvas.brushRegionToCanvas(region, bitmap).getContext("2d").getImageData(0, 0, width, height).data;
          }
          if (
            version !== generation ||
            annotation !== self.annotation ||
            annotation.isReadOnly() ||
            (region && (region !== self.editableMask || region.isReadOnly()))
          )
            return;
          const { data, pixels } = applyLassoMask(base, points, width, height, self.operation);
          if (!pixels) {
            self.error = "The outline is too small. Select an area inside the image.";
            return;
          }
          const rle = Array.from(encode(data, data.length));
          annotation.history.freeze("lasso");
          annotation.pauseAutosave();
          try {
            if (region) region.replaceMask(rle);
            else {
              const control = self.control;
              const states = object.activeStates().filter((state) => state !== control);
              const created = annotation.createResult(
                { rle, coordstype: "px", dynamic: false },
                control.getResultValue(),
                control,
                object,
                false,
                states,
              );
              created.notifyDrawingFinished();
              annotation.selectArea(created);
            }
          } finally {
            annotation.history.unfreeze("lasso");
            annotation.startAutosave();
          }
          self.cancelDrawing();
        } catch (error) {
          if (version === generation) self.error = `Could not apply the selection: ${error.message}`;
        } finally {
          if (version === generation) self.busy = false;
        }
      }),
    };
  });

export const PolygonalLasso = types
  .compose("PolygonalLassoTool", ToolMixin, BaseTool, LassoModel)
  .props({ kind: "polygonal" });
export const FreehandLasso = types
  .compose("FreehandLassoTool", ToolMixin, BaseTool, LassoModel)
  .props({ kind: "freehand" });
export const MagneticLasso = types
  .compose("MagneticLassoTool", ToolMixin, BaseTool, LassoModel)
  .props({ kind: "magnetic" });
