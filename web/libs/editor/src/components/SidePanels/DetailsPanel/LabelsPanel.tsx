import { observer } from "mobx-react";
import { HtxLabels } from "../../../tags/control/Labels/Labels";
import styles from "./LabelsPanel.module.css";

const titles: Record<string, string> = {
  brushlabels: "Segmentation labels",
  keypointlabels: "Click to segment",
  rectanglelabels: "Box selection",
};

// Render the existing label models: selection, tools, colors and hotkeys stay
// shared with the controls in the task, without duplicating annotation tags.
export const LabelsPanel = observer(({ currentEntity }: any) => {
  const controls = Array.from(currentEntity?.names?.values() ?? []).filter(
    (tag: any) => titles[tag.type] && tag.visible !== false,
  ) as any[];

  return (
    <div className={styles.panel} data-testid="sidebar-labels">
      {controls.length ? controls.map((control) => (
        <section key={control.id} className={styles.group}>
          <h3 className={styles.heading}>{titles[control.type]}</h3>
          <HtxLabels item={control} />
        </section>
      )) : <p>No image segmentation labels in this task.</p>}
    </div>
  );
});
