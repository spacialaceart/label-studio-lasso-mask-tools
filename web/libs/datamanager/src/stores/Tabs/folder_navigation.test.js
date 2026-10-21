import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { destroy, getSnapshot, types } from "mobx-state-tree";
import { TabStore } from "./store";
import { folderFilterValue } from "./folder_filter";

const Root = types.model({
  viewsStore: types.optional(TabStore, {}),
  project: types.optional(types.frozen(), { id: 1 }),
  apiVersion: 2,
  SDK: types.optional(types.frozen(), { invoke: () => {}, hasInterface: () => false }),
});

describe("folder navigation", () => {
  let root;
  let view;
  let save;
  let toast;

  beforeEach(() => {
    toast = mock(() => {});
    root = Root.create({
      SDK: { invoke: toast, hasInterface: () => false },
      viewsStore: {
        columnsRaw: [
          { id: "storage_filename", title: "Storage filename", type: "String", target: "tasks", filterable: true },
          { id: "id", title: "ID", type: "Number", target: "tasks", filterable: true },
        ],
        views: [{ id: 1, key: "default", saved: true, hiddenColumns: {} }],
        selected: 1,
      },
    });
    root.viewsStore.fetchColumns();
    view = root.viewsStore.selected;
    save = spyOn(view, "save").mockResolvedValue(undefined);
  });

  afterEach(() => {
    save.mockRestore();
    destroy(root);
  });

  it("switches folders without accumulating filters and clears row selection", async () => {
    view.selected.toggleItem(26);
    await view.setFolderPrefix("E:\\chosen\\2016\\");
    expect(view.activeFolderPrefix).toBe("E:\\chosen\\2016\\");
    expect(view.filters).toHaveLength(1);
    expect(view.selected.list).toHaveLength(0);
    await view.setFolderPrefix("E:\\chosen\\2024\\");
    expect(view.filters).toHaveLength(1);
    expect(view.serializedFilters[0].value).toBe(folderFilterValue("E:\\chosen\\2024\\"));
    expect(view.serialize().data.folderPrefix).toBe("E:\\chosen\\2024\\");
  });

  it("All tasks removes only the folder filter and retains an existing ID filter", async () => {
    view.importFilters({
      conjunction: "and",
      items: [{ filter: "filter:tasks:id", type: "Number", operator: "greater", value: 30 }],
    });
    await view.setFolderPrefix("/chosen/2016/");
    expect(view.filters).toHaveLength(2);
    await view.setFolderPrefix("");
    expect(view.activeFolderPrefix).toBe("");
    expect(view.filters).toHaveLength(1);
    expect(view.filters[0].field.alias).toBe("id");
  });

  it("does not keep a stale highlight after the folder filter is removed manually", async () => {
    await view.setFolderPrefix("/chosen/2016/");
    view.deleteFilter(view.folderFilter);
    expect(view.activeFolderPrefix).toBe("");
  });

  it("preserves the selected folder in a saved snapshot", async () => {
    await view.setFolderPrefix("/chosen/2016/");
    const restored = Root.create({
      viewsStore: { columnsRaw: root.viewsStore.columnsRaw, views: [getSnapshot(view)], selected: 1 },
    });
    restored.viewsStore.fetchColumns();
    expect(restored.viewsStore.selected.activeFolderPrefix).toBe("/chosen/2016/");
    destroy(restored);
  });

  it("replaces earlier manual year-folder filters, including a Match any group", async () => {
    view.importFilters({
      conjunction: "or",
      items: ["\\2016\\", "\\2017\\"].map((value) => ({
        filter: "filter:tasks:storage_filename",
        type: "String",
        operator: "contains",
        value,
      })),
    });
    await view.setFolderPrefix("E:\\chosen\\2022\\");
    expect(view.activeFolderPrefix).toBe("E:\\chosen\\2022\\");
    expect(view.conjunction).toBe("and");
    expect(view.filters).toHaveLength(1);
    await view.setFolderPrefix("");
    expect(view.filters).toHaveLength(0);
  });

  it("does not broaden OR filters or modify a locked tab", async () => {
    view.importFilters({
      conjunction: "or",
      items: [{ filter: "filter:tasks:id", type: "Number", operator: "equal", value: 26 }],
    });
    await view.setFolderPrefix("/chosen/2016/");
    expect(view.activeFolderPrefix).toBe("");
    expect(view.filters).toHaveLength(1);
    expect(toast).toHaveBeenCalled();
    view.setConjunction("and");
    view.setLockState(true);
    await view.setFolderPrefix("/chosen/2016/");
    expect(view.activeFolderPrefix).toBe("");
  });

  it("escapes path metacharacters and respects folder boundaries in combined storage filenames", () => {
    const prefix = "E:\\Coral Data (test)\\chosen\\2016\\";
    const value = folderFilterValue(prefix);
    const regex = new RegExp(value.replace(/^\(\?i\)/, ""), "i");
    expect(regex.test(`;;;${prefix}photo.JPG;`)).toBe(true);
    expect(regex.test(";;;E:\\Coral Data (test)\\chosen\\20160\\photo.JPG;")).toBe(false);
    expect(regex.test(";;;E:\\Coral Data test\\chosen\\2016\\photo.JPG;")).toBe(false);
  });
});
