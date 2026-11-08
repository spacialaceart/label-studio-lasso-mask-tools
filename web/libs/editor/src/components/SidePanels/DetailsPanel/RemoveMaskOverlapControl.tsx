import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@humansignal/ui";
import { maskOverlapReason, prepareOverlapRemoval } from "../../../utils/removeMaskOverlap";
import styles from "./RemoveMaskOverlapControl.module.css";

const maskName = (region: any) => {
  const labels = region.labelings.flatMap((result: any) =>
    (result.selectedLabels ?? []).map((label: any) => label.value),
  );
  return `${labels.join(", ") || "Mask"} · ${region.cleanId}`;
};

const OverlapControls = observer(({ selection }: { selection: any }) => {
  const regions = [...selection.list].sort((a, b) => a.ouid - b.ouid);
  const [keepID, setKeepID] = useState(regions[0].id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const reason = maskOverlapReason(regions);
  const keep = regions.find((region) => region.id === keepID) ?? regions[0];
  const target = regions.find((region) => region !== keep);

  return (
    <div className={styles.panel} aria-label="Remove mask overlap">
      {regions.length === 2 && (
        <>
          <label className={styles.field}>
            Keep mask
            <span className={styles.swatch} style={{ background: keep.getOneColor() }} aria-hidden="true" />
            <select
              aria-label="Keep mask"
              value={keep.id}
              disabled={busy || !!reason}
              onChange={(event) => {
                setKeepID(event.target.value);
                setMessage("");
                setError("");
              }}
            >
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {maskName(region)}
                </option>
              ))}
            </select>
          </label>
          <div>Trim overlap from {maskName(target)}. A completely covered mask will be removed.</div>
        </>
      )}
      <Button
        type="button"
        disabled={busy || !!reason}
        title={reason || "Keep the chosen mask and remove its pixels from the other mask"}
        onClick={async () => {
          const controller = new AbortController();
          pending.current = controller;
          setBusy(true);
          setMessage("");
          setError("");
          try {
            const prepared = await prepareOverlapRemoval(keep, target, controller.signal);
            if (controller.signal.aborted) return;
            selection.annotation.removeMaskOverlap(prepared);
            setMessage(
              prepared.removed
                ? `Removed ${prepared.removed.toLocaleString()} overlapping pixels.`
                : "No overlap found.",
            );
          } catch (cause) {
            if (!controller.signal.aborted) setError((cause as Error).message);
          } finally {
            if (!controller.signal.aborted) setBusy(false);
            if (pending.current === controller) pending.current = null;
          }
        }}
      >
        {busy ? "Removing overlap…" : "Remove overlap"}
      </Button>
      {reason && <div>{reason}</div>}
      {(busy || message) && <div role="status">{busy ? "Processing masks…" : message}</div>}
      {error && <div role="alert">{error}</div>}
    </div>
  );
});

export const RemoveMaskOverlapControl = observer(({ selection }: { selection: any }) => {
  const regions = selection.list;
  if (regions.length < 2 || regions.some((region: any) => region.type !== "brushregion")) return null;
  // Reset the choice/messages and cancel pending work when the selected pair changes.
  return (
    <OverlapControls
      key={regions
        .map((region: any) => region.id)
        .sort()
        .join(":")}
      selection={selection}
    />
  );
});
