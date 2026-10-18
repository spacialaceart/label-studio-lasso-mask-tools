import { observer } from "mobx-react";
import { Circle, Layer, Line } from "react-konva";
import styles from "./LassoOverlay.module.css";

export const LassoOverlay = observer(({ item }) => {
  const tool = item.getToolsManager().findSelectedTool();
  if (!tool?.isLasso || !tool.points.length) return null;
  const points = [...tool.points, ...tool.preview].flatMap(([x, y]) => [
    item.internalToCanvasX(x),
    item.internalToCanvasY(y),
  ]);
  const zoom = item.zoomScale || 1;
  return (
    <Layer listening={false}>
      <Line
        points={points}
        closed={points.length >= 6}
        fill="rgba(66, 153, 225, 0.18)"
        stroke="#111827"
        strokeWidth={3}
        strokeScaleEnabled={false}
      />
      <Line
        points={points}
        closed={points.length >= 6}
        stroke="#fff"
        strokeWidth={1.5}
        dash={[5 / zoom, 4 / zoom]}
        strokeScaleEnabled={false}
      />
      {tool.kind !== "freehand" &&
        tool.anchors.map((count, i) => {
          const [x, y] = tool.points[count - 1];
          return (
            <Circle
              key={`${count}-${i}`}
              x={item.internalToCanvasX(x)}
              y={item.internalToCanvasY(y)}
              radius={(i === 0 ? 5 : 3) / zoom}
              fill={i === 0 ? "#60a5fa" : "#fff"}
              stroke="#111827"
              strokeWidth={1}
              strokeScaleEnabled={false}
            />
          );
        })}
    </Layer>
  );
});

export const LassoControls = observer(({ item }) => {
  const tool = item.getToolsManager().findSelectedTool();
  if (!tool?.isLasso) return null;
  return (
    <div
      className={styles.panel}
      aria-label="Lasso options"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.row}>
        <strong>{tool.title}</strong>
        <label>
          Action
          <select
            aria-label="Lasso action"
            value={tool.operation}
            disabled={tool.isDrawing}
            onChange={(e) => tool.setOperation(e.target.value)}
          >
            <option value="new">New mask</option>
            <option value="add">Add to mask</option>
            <option value="subtract">Subtract from mask</option>
          </select>
        </label>
      </div>
      {tool.kind === "magnetic" && (
        <div className={styles.row}>
          <label>
            Search radius{" "}
            <input
              aria-label="Magnetic search radius"
              type="range"
              min="4"
              max="80"
              value={tool.searchRadius}
              disabled={tool.busy}
              onChange={(e) => tool.setSearchRadius(Number(e.target.value))}
            />
            {tool.searchRadius}
          </label>
          <label>
            Edge sensitivity{" "}
            <input
              aria-label="Magnetic edge sensitivity"
              type="range"
              min="1"
              max="10"
              value={tool.sensitivity}
              disabled={tool.busy}
              onChange={(e) => tool.setSensitivity(Number(e.target.value))}
            />
            {tool.sensitivity}
          </label>
        </div>
      )}
      <div className={styles.hint}>
        {tool.kind === "freehand"
          ? "Drag around an area; release to fill. Esc cancels."
          : "Click to place points. Close the outline or press Enter to fill. Backspace undoes a point; Esc cancels."}
      </div>
      {tool.operation !== "new" && !tool.editableMask && !tool.isDrawing && (
        <div className={styles.hint}>Select one mask in the Regions list to edit it.</div>
      )}
      {tool.isDrawing && (
        <div className={styles.row}>
          <button type="button" onClick={() => tool.finishDrawing()} disabled={tool.busy || tool.points.length < 3}>
            Apply selection
          </button>
          {tool.kind !== "freehand" && (
            <button type="button" onClick={() => tool.undoPoint()} disabled={tool.busy}>
              Undo point
            </button>
          )}
          <button type="button" onClick={() => tool.cancelDrawing()}>
            Cancel
          </button>
          {tool.busy && <span role="status">{tool.kind === "magnetic" ? "Tracing edges…" : "Applying…"}</span>}
        </div>
      )}
      {tool.error && (
        <div className={styles.error} role="alert">
          {tool.error}
        </div>
      )}
    </div>
  );
});
