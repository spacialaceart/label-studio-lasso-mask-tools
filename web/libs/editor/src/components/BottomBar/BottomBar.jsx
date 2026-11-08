import { observer } from "mobx-react";
import { isStarterCloudPlan } from "@humansignal/core";
import { cn } from "../../utils/bem";
import { Actions } from "./Actions";
import { Controls } from "./Controls";
import { CurrentTask } from "./CurrentTask";
import { LassoControls } from "../ImageView/LassoOverlay";
import "./BottomBar.prefix.css";

export const BottomBar = observer(({ store }) => {
  const annotationStore = store.annotationStore;
  const entity = annotationStore?.selected;
  const isPrediction = entity?.type === "prediction";

  const isViewAll = annotationStore?.viewingAll === true;
  const isBulkMode = !isStarterCloudPlan() && store.hasInterface("annotation:bulk");
  const lassoImages =
    entity?.objects?.filter(
      (item) => item.type === "image" && item.imageIsLoaded && item.getToolsManager().findSelectedTool()?.isLasso,
    ) ?? [];

  return store && !isViewAll ? (
    <div className={cn("bottombar").toClassName()}>
      {lassoImages.length > 0 && (
        <div className={cn("bottombar").elem("lasso-controls").toClassName()}>
          {lassoImages.map((item) => (
            <LassoControls key={item.name} item={item} />
          ))}
        </div>
      )}
      <div className={cn("bottombar").elem("group").toClassName()}>
        {!isBulkMode && <CurrentTask store={store} />}
        <Actions store={store} />
      </div>
      <div className={cn("bottombar").elem("group").toClassName()}>
        {store.hasInterface("controls") && (store.hasInterface("review") || !isPrediction) && (
          <div className={cn("bottombar").elem("section").mod({ flat: true }).toClassName()}>
            <Controls annotation={entity} />
          </div>
        )}
      </div>
    </div>
  ) : null;
});
