import { useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@humansignal/ui";
import { mergeMasksReason, prepareMaskMerge } from "../../../utils/mergeMasks";

export const MergeMasksButton = observer(({ selection }: { selection: any }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const regions = selection.list;
  if (regions.length < 2) return null;
  const reason = mergeMasksReason(regions);
  return (
    <div style={{ padding: 12 }}>
      <Button
        type="button"
        disabled={busy || !!reason}
        title={reason || "Combine selected masks and keep the oldest region ID"}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const rle = await prepareMaskMerge(regions);
            if (selection.list.length !== regions.length || regions.some((r) => !selection.list.includes(r)))
              throw new Error("The selection changed. Try merging again.");
            selection.annotation.mergeMasks(regions, rle);
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Merging…" : "Merge selected masks"}
      </Button>
      {reason && <div style={{ marginTop: 6 }}>{reason}</div>}
      {error && <div role="alert">{error}</div>}
    </div>
  );
});
