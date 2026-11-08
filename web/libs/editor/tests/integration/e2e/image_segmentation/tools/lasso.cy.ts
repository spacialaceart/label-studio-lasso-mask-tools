import { decode } from "@thi.ng/rle-pack";
import { Hotkeys, ImageView, LabelStudio, Labels, Sidebar } from "@humansignal/frontend-test/helpers/LSF";

const config = `<View><BrushLabels name="mask" toName="image"><Label value="Coral" background="#ff3300" /></BrushLabels>
  <Image name="image" value="$image" zoom="true" zoomControl="true" rotateControl="true" /></View>`;
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><rect x="40" y="40" width="100" height="100" fill="black"/></svg>')}`;
const init = (result = [], xml = config) => {
  LabelStudio.params().config(xml).data({ image }).withResult(result).init();
  LabelStudio.waitForImageReady();
  Labels.select("Coral");
};
const tool = (kind = "polygonal") => cy.get(`[aria-label="${kind}-lasso"]`).click();
const polygon = (points: number[][]) => {
  ImageView.drawPolygonRelative(points as [number, number][], false);
  cy.get("body").type("{enter}");
  cy.get('[aria-label="Lasso options"] [role="alert"]').should("not.exist");
};
const checkPixel = (x: number, y: number, expected: number | "painted") =>
  LabelStudio.serialize().then((result) => {
    const mask = result.find((entry) => entry.value.rle);
    expect(mask, "saved brush mask").to.exist;
    expect(mask.value.format).to.equal("rle");
    const assertion = expect(decode(mask.value.rle)[(y * 200 + x) * 4 + 3], `pixel ${x},${y}`);
    if (expected === "painted") assertion.to.be.greaterThan(0);
    else assertion.to.equal(expected);
  });
const square = [
  [0.1, 0.1],
  [0.6, 0.1],
  [0.6, 0.6],
  [0.1, 0.6],
];

describe("Image segmentation - Lasso tools", () => {
  it("keeps compact lasso controls floating above Submit while the image content scrolls", () => {
    init();
    tool("freehand");
    let panelBottom;
    const checkDock = ($panel) => {
      const panel = $panel[0];
      const bar = panel.closest(".lsf-bottombar");
      expect(bar, "docked in the Submit bar").to.exist;
      const bounds = panel.getBoundingClientRect();
      const barBounds = bar.getBoundingClientRect();
      expect(barBounds.top - bounds.bottom, "gap above Submit bar").to.be.within(0, 8);
      expect(bounds.left).to.be.at.least(barBounds.left);
      expect(bounds.right).to.be.at.most(barBounds.right);
      if (panelBottom !== undefined) expect(bounds.bottom).to.equal(panelBottom);
      panelBottom = bounds.bottom;
    };
    cy.get('[aria-label="Lasso options"]').should("have.length", 1).and("be.visible").should(checkDock);
    cy.get(".lsf-main-content").scrollTo("bottom", { ensureScrollable: false });
    cy.get('[aria-label="Lasso options"]').should("be.visible").should(checkDock);
    cy.screenshot("floating-lasso-controls", { capture: "viewport" });
    cy.get('[aria-label="Lasso action"]').select("subtract");
    cy.get('[aria-label="Lasso options"]').should("contain", "Select one mask").should(checkDock);
    cy.get('[aria-label="brush-tool"]').click();
    cy.get('[aria-label="Lasso options"]').should("not.exist");
  });

  it("merges selected masks into the oldest ID and reloads the result", () => {
    init();
    tool();
    polygon(square);
    polygon([
      [0.65, 0.65],
      [0.9, 0.65],
      [0.9, 0.9],
      [0.65, 0.9],
    ]);
    let oldestID;
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      const regions = [...annotation.regionStore.regions].sort((a, b) => a.ouid - b.ouid);
      oldestID = regions[0].cleanId;
      regions[0].setParentID(regions[1].id);
      annotation.selectAreas([...regions].reverse());
    });
    cy.screenshot("merge-selected-masks", { capture: "viewport" });
    cy.contains("button", "Merge selected masks").should("be.enabled").click();
    Sidebar.hasRegions(1);
    checkPixel(50, 50, 255);
    checkPixel(150, 150, 255);
    checkPixel(125, 125, 0);
    LabelStudio.serialize().then((result) => {
      expect(result[0].id).to.equal(oldestID);
      init(result);
    });
    checkPixel(150, 150, 255);
  });
  it("undoes and redoes a mask merge in one step", () => {
    init();
    tool();
    polygon(square);
    polygon([
      [0.65, 0.65],
      [0.9, 0.65],
      [0.9, 0.9],
      [0.65, 0.9],
    ]);
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      annotation.selectAreas(annotation.regionStore.regions);
    });
    cy.contains("button", "Merge selected masks").click();
    Sidebar.hasRegions(1);
    Hotkeys.undo();
    Sidebar.hasRegions(2);
    Hotkeys.redo();
    Sidebar.hasRegions(1);
    checkPixel(150, 150, 255);
  });
  it("redirects relations and preserves children when merging an ancestor into its descendant", () => {
    init();
    tool();
    polygon(square);
    polygon([
      [0.65, 0.65],
      [0.9, 0.65],
      [0.9, 0.9],
      [0.65, 0.9],
    ]);
    polygon([
      [0.7, 0.1],
      [0.9, 0.1],
      [0.9, 0.3],
      [0.7, 0.3],
    ]);
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      const [oldest, newer, external] = [...annotation.regionStore.regions].sort((a, b) => a.ouid - b.ouid);
      oldest.setParentID(external.id);
      external.setParentID(newer.id);
      annotation.relationStore.addRelation(newer, external);
      annotation.relationStore.addRelation(oldest, newer);
      annotation.selectAreas([newer, oldest]);
    });
    cy.contains("button", "Merge selected masks").click();
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      expect(annotation.regionStore.regions).to.have.length(2);
      const [oldest, external] = [...annotation.regionStore.regions].sort((a, b) => a.ouid - b.ouid);
      expect(oldest.parentID).to.not.equal(external.id);
      expect(external.parentID).to.equal(oldest.id);
      expect(annotation.relationStore.relations).to.have.length(1);
      expect(annotation.relationStore.relations[0].node1).to.equal(oldest);
      expect(annotation.relationStore.relations[0].node2).to.equal(external);
    });
    Hotkeys.undo();
    cy.window().then((win) => {
      expect(win.Htx.annotationStore.selected.regionStore.regions).to.have.length(3);
      expect(win.Htx.annotationStore.selected.relationStore.relations).to.have.length(2);
    });
  });
  it("disables merging masks with different labels", () => {
    init([], config.replace('<Label value="Coral"', '<Label value="Other"/><Label value="Coral"'));
    tool();
    polygon(square);
    cy.window().then((win) => win.Htx.annotationStore.selected.unselectAreas());
    Labels.select("Other");
    polygon([
      [0.65, 0.65],
      [0.9, 0.65],
      [0.9, 0.9],
      [0.65, 0.9],
    ]);
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      annotation.selectAreas(annotation.regionStore.regions);
    });
    cy.contains("button", "Merge selected masks").should("be.disabled");
  });
  it("keeps mask coordinates correct on a rotated, zoomed, and panned non-square image", () => {
    const rectangular = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#bcd"/></svg>')}`;
    LabelStudio.params().config(config).data({ image: rectangular }).withResult([]).init();
    LabelStudio.waitForImageReady();
    Labels.select("Coral");
    ImageView.rotateRight();
    cy.get('[aria-label="zoom-in"]').click();
    ImageView.drawingArea
      .trigger("mousedown", 300, 250, { eventConstructor: "MouseEvent", button: 1, buttons: 4 })
      .trigger("mousemove", 330, 270, { eventConstructor: "MouseEvent", buttons: 4, movementX: 30, movementY: 20 })
      .trigger("mouseup", 330, 270, { eventConstructor: "MouseEvent", button: 1 });
    tool();
    cy.window().then((win) => {
      const object = win.Htx.annotationStore.selected.objects.find((item) => item.type === "image");
      expect(object.rotation).to.equal(90);
      expect(object.zoomScale).to.be.greaterThan(1);
      const transform = object.stageRef.getAbsoluteTransform();
      const points = [
        [30, 30],
        [45, 30],
        [45, 60],
        [30, 60],
      ].map(([x, y]) => {
        const p = transform.point({ x: object.internalToCanvasX(x), y: object.internalToCanvasY(y) });
        return [p.x, p.y] as [number, number];
      });
      ImageView.drawPolygon(points, false);
    });
    cy.get("body").type("{enter}");
    Sidebar.hasRegions(1);
    checkPixel(75, 50, 255);
    checkPixel(20, 20, 0);
  });
  it("rejects Add without a target and clears drafts on annotation switches", () => {
    init();
    tool();
    cy.get('[aria-label="Lasso action"]').select("add");
    ImageView.clickAtRelative(0.2, 0.2);
    cy.get('[aria-label="Lasso options"] [role="alert"]').should("contain", "Select one editable mask");
    Sidebar.hasRegions(0);
    cy.get('[aria-label="Lasso action"]').select("new");
    ImageView.drawPolygonRelative(square as [number, number][], false);
    cy.window().then((win) => {
      const store = win.Htx.annotationStore;
      const original = store.selected;
      const next = store.addAnnotation({ result: [] });
      store.selectAnnotation(next.id);
      expect(original.isDrawing).to.equal(false);
      expect(original.serializeAnnotation()).to.have.length(0);
      store.selectAnnotation(original.id);
    });
    cy.contains('[aria-label="Lasso options"] button', "Apply selection").should("not.be.visible");
    Labels.select("Coral");
    tool();
    polygon(square);
    Sidebar.hasRegions(1);
  });
  it("creates a polygonal brush mask, supports undo/redo, and reloads its RLE", () => {
    init();
    tool();
    polygon(square);
    Sidebar.hasRegions(1);
    checkPixel(50, 50, 255);
    checkPixel(150, 150, 0);
    cy.screenshot("polygonal-lasso-mask", { capture: "viewport" });
    Hotkeys.undo();
    Sidebar.hasRegions(0);
    Hotkeys.redo();
    Sidebar.hasRegions(1);
    checkPixel(50, 50, 255);
    LabelStudio.serialize().then((result) => {
      init(result);
      checkPixel(50, 50, 255);
      checkPixel(150, 150, 0);
    });
  });
  it("adds to one mask and subtracts a hole with one undo per operation", () => {
    init();
    tool();
    polygon(square);
    cy.get('[aria-label="Lasso action"]').select("add");
    polygon([
      [0.65, 0.1],
      [0.85, 0.1],
      [0.85, 0.3],
      [0.65, 0.3],
    ]);
    Sidebar.hasRegions(1);
    checkPixel(150, 40, 255);
    cy.get('[aria-label="Lasso action"]').select("subtract");
    polygon([
      [0.2, 0.2],
      [0.4, 0.2],
      [0.4, 0.4],
      [0.2, 0.4],
    ]);
    checkPixel(60, 60, 0);
    checkPixel(30, 30, 255);
    checkPixel(150, 40, 255);
    Hotkeys.undo();
    checkPixel(60, 60, 255);
    Hotkeys.redo();
    checkPixel(60, 60, 0);
  });
  it("cancels without saving and removes the last polygon point", () => {
    init();
    tool();
    ImageView.drawPolygonRelative(square as [number, number][], false);
    cy.get("body").type("{esc}");
    Sidebar.hasRegions(0);
    ImageView.drawPolygonRelative(square as [number, number][], false);
    cy.get("body").type("{backspace}{enter}");
    Sidebar.hasRegions(1);
    checkPixel(30, 110, 0);
    checkPixel(100, 40, 255);
  });
  it("closes with a click on the starting point and with a double click", () => {
    init();
    tool();
    ImageView.drawPolygonRelative(square as [number, number][], true);
    Sidebar.hasRegions(1);
    checkPixel(50, 50, 255);
    ImageView.clickAtRelative(0.65, 0.1);
    ImageView.clickAtRelative(0.85, 0.1);
    ImageView.dblClickAtRelative(0.85, 0.3);
    Sidebar.hasRegions(2);
  });
  it("preserves brush edits and erasures when applying subsequent lassos", () => {
    init();
    tool();
    polygon(square);
    cy.get('[aria-label="eraser"]').click();
    ImageView.drawRectRelative(0.3, 0.25, 0, 0.2);
    checkPixel(60, 70, 0);
    tool();
    cy.get('[aria-label="Lasso action"]').select("add");
    polygon([
      [0.7, 0.1],
      [0.9, 0.1],
      [0.9, 0.3],
      [0.7, 0.3],
    ]);
    checkPixel(60, 70, 0);
    checkPixel(160, 40, 255);
    cy.get('[aria-label="brush-tool"]').click();
    ImageView.drawRectRelative(0.3, 0.25, 0, 0.2);
    checkPixel(60, 70, "painted");
    tool();
    cy.get('[aria-label="Lasso action"]').select("subtract");
    polygon([
      [0.2, 0.2],
      [0.4, 0.2],
      [0.4, 0.4],
      [0.2, 0.4],
    ]);
    checkPixel(60, 60, 0);
    checkPixel(160, 40, 255);
  });
  it("creates a freehand mask on release", () => {
    init();
    tool("freehand");
    ImageView.drawingFrame.then(($el) => {
      const { width, height } = $el[0].getBoundingClientRect();
      const area = ImageView.drawingArea;
      area.trigger("mousedown", width * 0.1, height * 0.1, { eventConstructor: "MouseEvent", button: 0, buttons: 1 });
      for (const [x, y] of square.slice(1))
        area.trigger("mousemove", width * x, height * y, { eventConstructor: "MouseEvent", buttons: 1 });
      area.trigger("mouseup", width * 0.1, height * 0.1, { eventConstructor: "MouseEvent", button: 0 });
    });
    Sidebar.hasRegions(1);
    checkPixel(50, 50, 255);
    checkPixel(150, 150, 0);
  });
  it("keeps the zoomed and panned image stationary when a freehand stroke starts and ends", () => {
    init();
    tool("freehand");
    cy.get('[aria-label="zoom-in"]').click().click();
    ImageView.drawingArea
      .trigger("mousedown", 300, 250, { eventConstructor: "MouseEvent", button: 1, buttons: 4 })
      .trigger("mousemove", 330, 270, { eventConstructor: "MouseEvent", buttons: 4, movementX: 30, movementY: 20 })
      .trigger("mouseup", 330, 270, { eventConstructor: "MouseEvent", button: 1 });

    let initial;
    const snapshot = (element) => {
      const object = element.ownerDocument.defaultView.Htx.annotationStore.selected.objects.find(
        (item) => item.type === "image",
      );
      const { x, y, width, height } = element.getBoundingClientRect();
      return {
        x,
        y,
        width,
        height,
        zoom: object.zoomScale,
        panX: object.zoomingPositionX,
        panY: object.zoomingPositionY,
      };
    };
    // Let zoom/pan and the image ResizeObserver settle before recording the viewport.
    ImageView.drawingArea.should(($el) => expect(snapshot($el[0]).zoom).to.be.greaterThan(1));
    cy.wait(100);
    ImageView.drawingArea.then(($el) => {
      initial = snapshot($el[0]);
    });
    const unchanged = () => ImageView.drawingArea.should(($el) => expect(snapshot($el[0])).to.deep.equal(initial));
    const start = () =>
      ImageView.drawingArea.trigger("mousedown", 300, 250, { eventConstructor: "MouseEvent", button: 0, buttons: 1 });

    start();
    cy.contains("button", "Apply selection").should("be.visible");
    unchanged();
    cy.get("body").type("{esc}");
    unchanged();
    start();
    unchanged();
    ImageView.drawingArea
      .trigger("mousemove", 400, 250, { eventConstructor: "MouseEvent", buttons: 1 })
      .trigger("mousemove", 400, 350, { eventConstructor: "MouseEvent", buttons: 1 })
      .trigger("mouseup", 300, 350, { eventConstructor: "MouseEvent", button: 0 });
    Sidebar.hasRegions(1);
    unchanged();
  });
  it("runs magnetic edge tracing in a worker and saves a normal brush mask", () => {
    init();
    tool("magnetic");
    for (const [x, y] of [
      [0.2, 0.2],
      [0.7, 0.2],
      [0.7, 0.7],
      [0.2, 0.7],
    ]) {
      ImageView.clickAtRelative(x, y);
      cy.get('[aria-label="Lasso options"] [role="status"]').should("not.exist");
    }
    cy.get("body").type("{enter}");
    Sidebar.hasRegions(1);
    checkPixel(80, 80, 255);
    checkPixel(170, 170, 0);
  });
  it("also works with separate Labels and Brush controls", () => {
    init(
      [],
      config.replaceAll("BrushLabels", "Labels").replace("<Image ", '<Brush name="brush" toName="image" /><Image '),
    );
    tool();
    polygon(square);
    checkPixel(50, 50, 255);
    LabelStudio.serialize().then((result) =>
      expect(result.some((entry) => entry.value.labels?.includes("Coral"))).to.equal(true),
    );
  });
});
