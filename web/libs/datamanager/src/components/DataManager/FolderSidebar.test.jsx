import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FolderSidebarContent } from "./FolderSidebar";

afterEach(cleanup);

const folder = {
  name: "chosen",
  prefix: "E:\\chosen\\",
  count: 3,
  children: [
    { name: "2016", prefix: "E:\\chosen\\2016\\", count: 2, children: [] },
    { name: "2024", prefix: "E:\\chosen\\2024\\", count: 1, children: [] },
  ],
};

function setup(result = { folders: [folder] }, overrides = {}) {
  const store = { apiCall: mock(async () => result) };
  const view = { activeFolderPrefix: "", target: "tasks", setFolderPrefix: mock(async () => {}), ...overrides };
  render(<FolderSidebarContent store={store} view={view} projectId={1} totalTasks={3} />);
  return { store, view };
}

describe("FolderSidebar", () => {
  it("loads the whole project's folders and opens a year without importing tasks", async () => {
    const { store, view } = setup();
    const year = await screen.findByRole("button", { name: /2016/ });
    expect(store.apiCall.mock.calls[0][0]).toBe("folders");
    expect(store.apiCall.mock.calls[0][1]).toEqual({ project: 1 });
    fireEvent.click(year);
    await waitFor(() => expect(view.setFolderPrefix).toHaveBeenCalledWith("E:\\chosen\\2016\\"));
    fireEvent.click(screen.getByRole("button", { name: /All tasks/ }));
    await waitFor(() => expect(view.setFolderPrefix).toHaveBeenLastCalledWith(""));
  });

  it("supports expanding folders, collapsing the sidebar, and a saved selected folder", async () => {
    setup(undefined, { activeFolderPrefix: "E:\\chosen\\2016\\" });
    const year = await screen.findByRole("button", { name: /2016/ });
    expect(year.getAttribute("aria-current")).toBe("location");
    fireEvent.click(screen.getByRole("button", { name: "Collapse chosen" }));
    expect(screen.queryByRole("button", { name: /2016/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand chosen" }));
    expect(screen.getByRole("button", { name: /2016/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide folders" }));
    expect(screen.queryByRole("button", { name: /All tasks/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show folders" }));
    expect(screen.getByRole("button", { name: /All tasks/ })).toBeTruthy();
  });

  it("hides itself when the project has no imported local files", async () => {
    setup({ folders: [] });
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Task folders" })).toBeNull());
  });

  it("shows a retry control after folder loading fails", async () => {
    const { store } = setup({ error: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load folders");
    fireEvent.click(screen.getByRole("button", { name: "Refresh folders" }));
    await waitFor(() => expect(store.apiCall).toHaveBeenCalledTimes(2));
  });
});
