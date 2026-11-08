import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CpcControls, pointText, saveOverlay } from "../CpcOverlay";

const data = {
  file: "coral.cpc",
  dictionary: "codes.txt",
  warning: null,
  points: [{ x: 0.5, y: 0.25, label: "A", code: "POC", description: "Pocillopora", group: "coral", notes: "" }],
};
const makeItem = () => ({
  store: { project: { id: 42 }, task: { id: 1 } },
  value: "$image",
  currentImage: 0,
  stageWidth: 100,
  stageHeight: 100,
  zoomScale: 1,
  currentImageEntity: { currentSrc: "coral.jpg" },
});

beforeEach(() => {
  localStorage.clear();
  fetch.mockClear();
});

test("loads only when enabled, persists preferences and changes labels without refetching", async () => {
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(data)));
  render(<CpcControls item={makeItem()} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Show CPCE points"));
  await screen.findByTitle("codes.txt");
  expect(fetch.mock.calls[0][0]).toContain("/api/dm/tasks/1/cpc/?field=image&index=0");
  fireEvent.change(screen.getByLabelText("Point text"), { target: { value: "description" } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem("cpce-overlay:42")).text).toBe("description");
  expect(pointText(data.points[0], "description")).toBe("A · Pocillopora");
});

test("discards an old task response when navigation races loading", async () => {
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const item = makeItem();
  const view = render(<CpcControls item={item} />);
  fireEvent.click(screen.getByLabelText("Show CPCE points"));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...data, dictionary: "new.txt" })));
  const next = { ...item, store: { ...item.store, task: { id: 2 } } };
  view.rerender(<CpcControls item={next} />);
  await screen.findByTitle("new.txt");
  await act(async () => {
    finish(new Response(JSON.stringify(data)));
  });
  expect(screen.queryByTitle("codes.txt")).toBeNull();
});

test("reports missing sidecars and permits retry", async () => {
  fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: "No matching .cpc file beside this image" }), { status: 404 }),
  );
  render(<CpcControls item={makeItem()} />);
  fireEvent.click(screen.getByLabelText("Show CPCE points"));
  await screen.findByText("No matching .cpc file beside this image");
  expect(screen.getByRole("button", { name: "Save image with CPCE points" })).toBeDisabled();
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(data)));
  fireEvent.click(screen.getByRole("button", { name: "Reload points" }));
  await screen.findByTitle("codes.txt");
});

test("exports full source dimensions and selected descriptions at normalized coordinates", async () => {
  const originalImage = window.Image;
  const originalCreate = document.createElement.bind(document);
  const context = {
    drawImage: mock(),
    beginPath: mock(),
    moveTo: mock(),
    lineTo: mock(),
    stroke: mock(),
    fillText: mock(),
    measureText: () => ({ width: 80 }),
  };
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback) => callback(new Blob(["png"])) };
  const link = { click: mock() };
  window.Image = class {
    naturalWidth = 1000;
    naturalHeight = 800;
    set src(_value) {
      this.onload();
    }
  };
  const create = spyOn(document, "createElement").mockImplementation((tag, ...args) =>
    tag === "canvas" ? canvas : tag === "a" ? link : originalCreate(tag, ...args),
  );
  const createUrl = spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  try {
    await saveOverlay(makeItem(), data, { text: "description", size: 8, color: "#ff3030" });
    expect([canvas.width, canvas.height]).toEqual([1000, 800]);
    expect(context.moveTo).toHaveBeenCalledWith(420, 200);
    expect(context.fillText).toHaveBeenCalledWith("A · Pocillopora", 610, 200);
    expect(link.download).toBe("coral_points.png");
    expect(link.click).toHaveBeenCalledTimes(1);
  } finally {
    create.mockRestore();
    createUrl.mockRestore();
    window.Image = originalImage;
  }
});
