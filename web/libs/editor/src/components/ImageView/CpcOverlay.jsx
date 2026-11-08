import { useEffect, useState } from "react";
import { observable, runInAction } from "mobx";
import { observer } from "mobx-react";
import { Group, Layer, Line, Text } from "react-konva";
import styles from "./CpcOverlay.module.css";

const states = new WeakMap();
const defaults = { enabled: false, text: "both", color: "#ff3030", size: 8 };
const modes = {
  letter: "Letter",
  code: "Classification",
  both: "Letter + classification",
  description: "Full description",
};

function overlayState(item) {
  if (!states.has(item)) {
    states.set(item, observable({ options: { ...defaults }, data: null, key: "", error: "", loading: false }));
  }
  return states.get(item);
}

export function pointText(point, mode) {
  if (mode === "letter") return point.label;
  if (mode === "code") return point.code;
  if (mode === "description")
    return `${point.label} · ${point.description === "Unknown code" ? `${point.code} (unknown)` : point.description}`;
  return `${point.label} · ${point.code}`;
}

function imageKey(item) {
  return `${item.store.task?.id}:${item.usedValue ?? item.value}:${item.currentImage ?? 0}`;
}

// Export from the source image, not a viewport screenshot: pan/zoom never crops it.
export async function saveOverlay(item, data, options) {
  const image = new window.Image();
  if (item.imageCrossOrigin) image.crossOrigin = item.imageCrossOrigin;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Unable to load the image for export"));
    image.src = item.currentImageEntity.currentSrc;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const scale = image.naturalWidth / item.stageWidth;
  const radius = options.size * scale;
  const fontSize = 14 * scale;
  ctx.strokeStyle = options.color;
  ctx.fillStyle = options.color;
  ctx.lineWidth = Math.max(1, scale);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  for (const point of data.points) {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    ctx.beginPath();
    ctx.moveTo(x - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x, y + radius);
    ctx.stroke();
    const text = pointText(point, options.text);
    const left = Math.max(0, Math.min(x + radius + 3 * scale, canvas.width - ctx.measureText(text).width));
    ctx.fillText(text, left, Math.max(0, Math.min(y, canvas.height - fontSize)));
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Unable to encode the overlay image");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = data.file.replace(/\.cpc$/i, "_points.png");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CpcControls = observer(({ item }) => {
  const state = overlayState(item);
  const project = item.store.project?.id;
  const task = item.store.task?.id;
  const key = imageKey(item);
  const storageKey = `cpce-overlay:${project ?? "default"}`;
  const [ready, setReady] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch {
      /* optional persistence */
    }
    runInAction(() => {
      state.options = {
        enabled: saved?.enabled === true,
        text: modes[saved?.text] ? saved.text : defaults.text,
        color: /^#[0-9a-f]{6}$/i.test(saved?.color) ? saved.color : defaults.color,
        size: Number.isFinite(saved?.size) ? Math.max(3, Math.min(20, saved.size)) : defaults.size,
      };
    });
    setReady(true);
  }, [storageKey, state]);

  const enabled = state.options.enabled;
  useEffect(() => {
    if (!ready || !enabled || !task) return;
    const controller = new AbortController();
    runInAction(() => {
      state.key = key;
      state.data = null;
      state.error = "";
      state.loading = true;
    });
    const query = new URLSearchParams({
      field: (item.usedValue ?? item.value)?.replace(/^\$/, "") || "image",
      index: String(item.currentImage ?? 0),
    });
    const base = (window.APP_SETTINGS?.hostname || "").replace(/\/$/, "");
    fetch(`${base}/api/dm/tasks/${task}/cpc/?${query}`, { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.validation_errors?.non_field_errors?.[0] || data.detail || "Unable to load CPCE points");
        if (!controller.signal.aborted)
          runInAction(() => {
            state.data = data;
          });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          runInAction(() => {
            state.error = error.message;
          });
      })
      .finally(() => {
        if (!controller.signal.aborted)
          runInAction(() => {
            state.loading = false;
          });
      });
    return () => controller.abort();
  }, [ready, enabled, task, key, refresh, state, item]);

  useEffect(() => {
    const stage = item.stageRef;
    setHover(null);
    if (!stage || !enabled) {
      setHover(null);
      return;
    }
    const move = (event) => {
      const pos = stage.getRelativePointerPosition();
      if (!pos || state.key !== imageKey(item)) return;
      const point = state.data?.points.find(
        (p) => Math.hypot(p.x * item.stageWidth - pos.x, p.y * item.stageHeight - pos.y) < 12 / item.zoomScale,
      );
      setHover(point ? { point, x: event.evt.clientX, y: event.evt.clientY } : null);
    };
    const leave = () => setHover(null);
    stage.on("mousemove", move);
    stage.on("mouseleave", leave);
    return () => {
      stage.off("mousemove", move);
      stage.off("mouseleave", leave);
    };
  }, [item, item.stageRef, enabled, state, key]);

  function update(values) {
    runInAction(() => {
      Object.assign(state.options, values);
    });
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.options));
    } catch {
      /* optional persistence */
    }
  }

  if (!task) return null;
  const data = state.key === key ? state.data : null;
  return (
    <div className={styles.panel} aria-label="CPCE point overlay">
      <div className={styles.row}>
        <label className={styles.toggle}>
          <input
            style={{ width: "auto" }}
            type="checkbox"
            checked={enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          Show CPCE points
        </label>
        {enabled && (
          <>
            <span className={styles.count} role="status" title={data?.dictionary}>
              {state.loading ? "Loading…" : data ? `${data.points.length} points` : "No points"}
            </span>
            <label>
              <select
                aria-label="Point text"
                value={state.options.text}
                onChange={(e) => update({ text: e.target.value })}
              >
                {Object.entries(modes).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <details
              className={styles.settings}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                  event.stopPropagation();
                }
              }}
            >
              <summary>Appearance</summary>
              <div className={styles.popover}>
                <label>
                  Color
                  <input type="color" value={state.options.color} onChange={(e) => update({ color: e.target.value })} />
                </label>
                <label>
                  Size
                  <input
                    type="range"
                    min="3"
                    max="20"
                    value={state.options.size}
                    onChange={(e) => update({ size: Number(e.target.value) })}
                  />
                </label>
                {data && (
                  <div className={styles.source}>
                    Code dictionary
                    <br />
                    {data.dictionary}
                  </div>
                )}
              </div>
            </details>
            <button
              className={styles.reload}
              type="button"
              aria-label="Reload points"
              title="Reload points from CPC file"
              disabled={state.loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              ↻
            </button>
            <button
              type="button"
              className={styles.export}
              aria-label="Save image with CPCE points"
              title="Download a full-resolution image with CPCE points"
              disabled={!data || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await saveOverlay(item, data, { ...state.options });
                } catch (error) {
                  runInAction(() => {
                    state.error = error.message;
                  });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save overlay"}
            </button>
          </>
        )}
      </div>
      {enabled && (state.error || data?.warning) && (
        <div className={styles.notice} role="status">
          {state.error || data?.warning}
        </div>
      )}
      {enabled && hover && data && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(hover.x + 15, window.innerWidth - 290)),
            top: Math.max(8, Math.min(hover.y + 15, window.innerHeight - 150)),
            zIndex: 10000,
            pointerEvents: "none",
            background: "#202020ee",
            color: "white",
            padding: 12,
            borderRadius: 8,
            maxWidth: 260,
          }}
        >
          <strong>
            Point {hover.point.label} · {hover.point.code}
          </strong>
          <div>{hover.point.description}</div>
          <div>Group: {hover.point.group || "Unknown"}</div>
          {hover.point.notes && <div>Notes: {hover.point.notes}</div>}
        </div>
      )}
    </div>
  );
});

export const CpcOverlay = observer(({ item }) => {
  const state = overlayState(item);
  if (!state.options.enabled || state.key !== imageKey(item) || !state.data) return null;
  const radius = state.options.size;
  return (
    <Layer listening={false}>
      {state.data.points.map((point, index) => {
        const text = pointText(point, state.options.text);
        const x = point.x * item.stageWidth;
        const y = point.y * item.stageHeight;
        return (
          <Group key={index}>
            <Line points={[x - radius, y, x + radius, y]} stroke={state.options.color} strokeWidth={1} />
            <Line points={[x, y - radius, x, y + radius]} stroke={state.options.color} strokeWidth={1} />
            <Text
              x={Math.max(0, Math.min(x + radius + 3, item.stageWidth - text.length * 8))}
              y={Math.max(0, Math.min(y, item.stageHeight - 16))}
              text={text}
              fontSize={14}
              fill={state.options.color}
            />
          </Group>
        );
      })}
    </Layer>
  );
});
