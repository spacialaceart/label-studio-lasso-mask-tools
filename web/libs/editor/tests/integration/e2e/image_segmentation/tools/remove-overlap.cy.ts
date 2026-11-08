import { decode, encode } from "@thi.ng/rle-pack";
import { Hotkeys, ImageView, LabelStudio, Sidebar } from "@humansignal/frontend-test/helpers/LSF";

const config = `<View><BrushLabels name="mask" toName="image"><Label value="Red" background="#ff3300"/><Label value="Yellow" background="#eeee00"/></BrushLabels><Image name="image" value="$image" zoom="true" zoomControl="true" rotateControl="true"/></View>`;
const image = (width = 200, height = 200) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/></svg>`)}`;
const mask = (id, label, rectangles, width = 200, height = 200) => {
  const pixels = new Uint8Array(width * height * 4);
  for (const [left, top, right, bottom] of rectangles)
    for (let y = top; y < bottom; y++) pixels.fill(255, (y * width + left) * 4, (y * width + right) * 4);
  return {
    id,
    from_name: "mask",
    to_name: "image",
    type: "brushlabels",
    original_width: width,
    original_height: height,
    image_rotation: 0,
    value: { format: "rle", rle: Array.from(encode(pixels, pixels.length)), brushlabels: [label] },
  };
};
const initial = () => [
  mask("red", "Red", [[20, 20, 100, 100]]),
  mask("yellow", "Yellow", [
    [60, 60, 140, 140],
    [160, 160, 180, 180],
  ]),
];
const init = (results = initial(), width = 200, height = 200) => {
  LabelStudio.params()
    .config(config)
    .data({ image: image(width, height) })
    .withResult(results)
    .init();
  LabelStudio.waitForImageReady();
  selectBoth();
};
const selectBoth = () =>
  cy.window().then((win) => {
    const annotation = win.Htx.annotationStore.selected;
    annotation.selectAreas(annotation.regionStore.regions);
  });
const keep = (id) =>
  cy
    .get('[aria-label="Keep mask"]')
    .find("option")
    .contains(`· ${id}`)
    .then(($option) => cy.get('[aria-label="Keep mask"]').select($option.val() as string));
const remove = () => cy.contains("button", "Remove overlap").click();
const pixel = (result, x, y, width = 200) => decode(result.value.rle)[(y * width + x) * 4 + 3];

describe("Remove mask overlap", () => {
  it("keeps the chosen label, trims exact overlap, preserves metadata and islands, and reloads", () => {
    const source = initial();
    init(source);
    keep("red");
    remove();
    cy.contains('[role="status"]', "Removed 1,600 overlapping pixels.").should("be.visible");
    Sidebar.hasRegions(2);
    LabelStudio.serialize().then((result) => {
      const red = result.find((r) => r.id === "red");
      const yellow = result.find((r) => r.id === "yellow");
      expect(red.value.rle).to.deep.equal(source[0].value.rle);
      expect(yellow.value.brushlabels).to.deep.equal(["Yellow"]);
      expect(pixel(yellow, 80, 80)).to.equal(0);
      expect(pixel(yellow, 120, 120)).to.equal(255);
      expect(pixel(yellow, 170, 170)).to.equal(255);
      init(result);
    });
    LabelStudio.serialize().then((result) =>
      expect(
        pixel(
          result.find((r) => r.id === "yellow"),
          80,
          80,
        ),
      ).to.equal(0),
    );
  });

  it("supports the reverse direction and one-step undo/redo", () => {
    init();
    keep("yellow");
    remove();
    LabelStudio.serialize().then((result) =>
      expect(
        pixel(
          result.find((r) => r.id === "red"),
          80,
          80,
        ),
      ).to.equal(0),
    );
    Hotkeys.undo();
    LabelStudio.serialize().then((result) =>
      expect(
        pixel(
          result.find((r) => r.id === "red"),
          80,
          80,
        ),
      ).to.equal(255),
    );
    Hotkeys.redo();
    LabelStudio.serialize().then((result) =>
      expect(
        pixel(
          result.find((r) => r.id === "red"),
          80,
          80,
        ),
      ).to.equal(0),
    );
  });

  it("removes a completely covered mask and restores it with undo", () => {
    init([mask("red", "Red", [[20, 20, 150, 150]]), mask("yellow", "Yellow", [[60, 60, 100, 100]])]);
    keep("red");
    remove();
    Sidebar.hasRegions(1);
    Hotkeys.undo();
    Sidebar.hasRegions(2);
    Hotkeys.redo();
    Sidebar.hasRegions(1);
  });

  it("rechecks restored mask bounds when removing overlap again after undo", () => {
    init([mask("red", "Red", [[20, 20, 100, 140]]), mask("yellow", "Yellow", [[60, 40, 140, 100]])]);
    keep("red");
    remove();
    Hotkeys.undo();
    selectBoth();
    keep("red");
    remove();
    cy.contains('[role="status"]', "Removed 2,400 overlapping pixels.").should("be.visible");
    LabelStudio.serialize().then((result) =>
      expect(
        pixel(
          result.find((r) => r.id === "yellow"),
          80,
          80,
        ),
      ).to.equal(0),
    );
  });

  it("preserves children through complete removal and restores relations and hierarchy on undo", () => {
    init([
      mask("red", "Red", [[20, 20, 150, 150]]),
      mask("yellow", "Yellow", [[60, 60, 100, 100]]),
      mask("child", "Yellow", [[160, 160, 180, 180]]),
    ]);
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      const [red, yellow, child] = ["red", "yellow", "child"].map((id) =>
        annotation.regionStore.regions.find((r) => r.cleanId === id),
      );
      yellow.setParentID(red.id);
      child.setParentID(yellow.id);
      annotation.relationStore.addRelation(red, yellow);
      annotation.relationStore.addRelation(yellow, child);
      annotation.selectAreas([red, yellow]);
    });
    keep("red");
    remove();
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      expect(annotation.regionStore.regions).to.have.length(2);
      const red = annotation.regionStore.regions.find((r) => r.cleanId === "red");
      expect(annotation.regionStore.regions.find((r) => r.cleanId === "child").parentID).to.equal(red.id);
      expect(annotation.relationStore.relations).to.have.length(0);
    });
    Hotkeys.undo();
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      expect(annotation.regionStore.regions).to.have.length(3);
      const yellow = annotation.regionStore.regions.find((r) => r.cleanId === "yellow");
      expect(annotation.regionStore.regions.find((r) => r.cleanId === "child").parentID).to.equal(yellow.id);
      expect(annotation.relationStore.relations).to.have.length(2);
    });
  });

  it("leaves disjoint masks and undo history unchanged", () => {
    const source = [mask("red", "Red", [[20, 20, 40, 40]]), mask("yellow", "Yellow", [[60, 60, 100, 100]])];
    init(source);
    let history;
    cy.window().then((win) => {
      history = win.Htx.annotationStore.selected.history.history.length;
    });
    remove();
    cy.contains('[role="status"]', "No overlap found.").should("be.visible");
    LabelStudio.serialize().then((result) =>
      expect(result.map((r) => r.value.rle)).to.deep.equal(source.map((r) => r.value.rle)),
    );
    cy.window().then((win) => expect(win.Htx.annotationStore.selected.history.history.length).to.equal(history));
  });

  it("composes brush additions and erasures and keeps cutouts after reloading", () => {
    init();
    cy.window().then((win) => {
      const annotation = win.Htx.annotationStore.selected;
      annotation.selectArea(annotation.regionStore.regions.find((r) => r.cleanId === "yellow"));
    });
    cy.get('[aria-label="brush-tool"]').click();
    ImageView.drawRectRelative(0.2, 0.25, 0, 0.2);
    cy.get('[aria-label="eraser"]').click();
    ImageView.drawRectRelative(0.55, 0.5, 0, 0.15);
    LabelStudio.serialize().then((result) => {
      const yellow = result.find((r) => r.id === "yellow");
      expect(pixel(yellow, 40, 70)).to.be.greaterThan(0);
      expect(pixel(yellow, 110, 120)).to.equal(0);
    });
    selectBoth();
    keep("red");
    remove();
    LabelStudio.serialize().then((result) => {
      const yellow = result.find((r) => r.id === "yellow");
      expect(pixel(yellow, 40, 70)).to.equal(0);
      expect(pixel(yellow, 80, 80)).to.equal(0);
      expect(pixel(yellow, 110, 120)).to.equal(0);
      expect(pixel(yellow, 130, 120)).to.equal(255);
      init(result);
    });
    LabelStudio.serialize().then((result) =>
      expect(
        pixel(
          result.find((r) => r.id === "yellow"),
          80,
          80,
        ),
      ).to.equal(0),
    );
  });

  it("processes large masks in a worker through zoom, rotation and pan", () => {
    const width = 1200;
    const height = 900;
    init(
      [
        mask("red", "Red", [[100, 100, 600, 600]], width, height),
        mask("yellow", "Yellow", [[400, 400, 800, 800]], width, height),
      ],
      width,
      height,
    );
    ImageView.rotateRight();
    cy.get('[aria-label="zoom-in"]').click();
    ImageView.drawingArea
      .trigger("mousedown", 300, 250, { eventConstructor: "MouseEvent", button: 1, buttons: 4 })
      .trigger("mousemove", 330, 270, { eventConstructor: "MouseEvent", buttons: 4, movementX: 30, movementY: 20 })
      .trigger("mouseup", 330, 270, { eventConstructor: "MouseEvent", button: 1 });
    keep("red");
    cy.window().then((win) => cy.spy(win, "Worker").as("overlapWorker"));
    remove();
    cy.get("@overlapWorker").should("have.been.calledOnce");
    cy.contains('[role="status"]', "Removed 40,000 overlapping pixels.", { timeout: 15000 }).should("be.visible");
    LabelStudio.serialize().then((result) => {
      const yellow = result.find((r) => r.id === "yellow");
      expect(pixel(yellow, 500, 500, width)).to.equal(0);
      expect(pixel(yellow, 700, 700, width)).to.equal(255);
    });
  });

  it("disables cleanup for hidden or read-only masks and for more than two selections", () => {
    init();
    cy.window().then((win) => win.Htx.annotationStore.selected.regionStore.regions[0].toggleHidden());
    cy.contains("button", "Remove overlap").should("be.disabled");
    cy.window().then((win) => {
      const region = win.Htx.annotationStore.selected.regionStore.regions[0];
      region.toggleHidden();
      region.setLocked(true);
    });
    cy.contains("button", "Remove overlap").should("be.disabled");
    init([...initial(), mask("third", "Red", [[160, 20, 180, 40]])]);
    cy.contains("button", "Remove overlap").should("be.disabled");
    cy.contains("Select exactly two masks.").should("be.visible");
  });

  for (const change of ["selection", "mask metadata"]) {
    it(`discards pending worker results after changing ${change}`, () => {
      const width = 1200;
      const height = 900;
      const source = [
        mask("red", "Red", [[100, 100, 600, 600]], width, height),
        mask("yellow", "Yellow", [[400, 400, 800, 800]], width, height),
      ];
      init(source, width, height);
      keep("red");
      let worker;
      cy.window().then((win) => {
        cy.stub(win, "Worker").callsFake(function () {
          worker = { postMessage() {}, terminate: cy.stub() };
          return worker;
        });
      });
      remove();
      cy.contains('[role="status"]', "Processing masks…").should("be.visible");
      cy.window().then((win) => {
        const annotation = win.Htx.annotationStore.selected;
        if (change === "selection") annotation.unselectAreas();
        else {
          const red = annotation.regionStore.regions.find((r) => r.cleanId === "red");
          const yellow = annotation.regionStore.regions.find((r) => r.cleanId === "yellow");
          yellow.setParentID(red.id);
          worker.onmessage({ data: { removed: 1, empty: true } });
        }
      });
      cy.wrap(null).should(() => expect(worker.terminate).to.have.been.calledOnce);
      if (change === "mask metadata") cy.contains('[role="alert"]', "selected masks changed").should("be.visible");
      cy.window().should((win) => expect(win.Htx.annotationStore.selected.regionStore.regions).to.have.length(2));
      LabelStudio.serialize().then((result) => {
        expect(result.find((r) => r.id === "yellow").value.rle).to.deep.equal(source[1].value.rle);
      });
    });
  }
});
