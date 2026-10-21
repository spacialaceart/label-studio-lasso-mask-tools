import { IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen, IconRefresh } from "@humansignal/icons";
import { inject, observer } from "mobx-react";
import { useEffect, useState } from "react";
import { cn } from "../../utils/bem";
import "./FolderSidebar.prefix.css";

const cls = cn("folder-sidebar");

function FolderNode({ folder, depth = 0, selected, disabled, onSelect }) {
  const [expanded, setExpanded] = useState(depth === 0 || selected.startsWith(folder.prefix));
  const hasChildren = folder.children.length > 0;
  const active = selected === folder.prefix;
  const FolderIcon = expanded && hasChildren ? IconFolderOpen : IconFolder;

  return (
    <li>
      <div className={cls.elem("row").mod({ active }).toClassName()} style={{ paddingLeft: 8 + depth * 16 }}>
        {hasChildren ? (
          <button
            type="button"
            className={cls.elem("expand").toClassName()}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <IconChevronDown /> : <IconChevronRight />}
          </button>
        ) : (
          <span className={cls.elem("spacer").toClassName()} />
        )}
        <button
          type="button"
          className={cls.elem("folder").toClassName()}
          aria-current={active ? "location" : undefined}
          title={folder.prefix}
          disabled={disabled}
          onClick={() => onSelect(folder.prefix)}
        >
          <FolderIcon className={cls.elem("icon").toClassName()} />
          <span className={cls.elem("name").toClassName()}>{folder.name}</span>
          <span className={cls.elem("count").toClassName()}>{folder.count.toLocaleString()}</span>
        </button>
      </div>
      {hasChildren && expanded && (
        <ul className={cls.elem("list").toClassName()}>
          {folder.children.map((child) => (
            <FolderNode
              key={child.prefix}
              folder={child}
              depth={depth + 1}
              selected={selected}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export const FolderSidebarContent = observer(function FolderSidebarContent({ store, view, projectId, totalTasks }) {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const selected = view?.activeFolderPrefix ?? "";

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    store
      .apiCall("folders", { project: projectId }, {}, { errorHandler: () => true })
      .then((result) => {
        if (result?.error || !Array.isArray(result?.folders)) throw new Error("Could not load folders.");
        if (current) setFolders(result.folders);
      })
      .catch(() => {
        if (current) setError("Could not load folders. Try refreshing.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [store, projectId, totalTasks, refresh]);

  if (!loading && !error && folders.length === 0) return null;

  const onSelect = async (prefix) => {
    setSelecting(true);
    try {
      await view.setFolderPrefix(prefix);
    } catch {
      setError("Could not open this folder. Try again.");
    } finally {
      setSelecting(false);
    }
  };
  const disabled = !view || selecting || view.isLockedByManager || view.target !== "tasks";

  return (
    <nav className={cls.mod({ collapsed }).toClassName()} aria-label="Task folders">
      <div className={cls.elem("header").toClassName()}>
        <button
          type="button"
          className={cls.elem("heading").toClassName()}
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Show folders" : "Hide folders"}
          aria-expanded={!collapsed}
        >
          <IconFolderOpen />
          {!collapsed && <span>Folders</span>}
        </button>
        {!collapsed && (
          <button
            type="button"
            className={cls.elem("refresh").toClassName()}
            title="Refresh folders"
            aria-label="Refresh folders"
            disabled={loading}
            onClick={() => setRefresh(refresh + 1)}
          >
            <IconRefresh />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className={cls.elem("body").toClassName()}>
          <button
            type="button"
            className={cls.elem("all").mod({ active: !selected }).toClassName()}
            aria-current={!selected ? "location" : undefined}
            disabled={disabled}
            title="Clear the folder filter; keep other filters"
            onClick={() => onSelect("")}
          >
            <span>All tasks</span>
            <span className={cls.elem("count").toClassName()}>{totalTasks.toLocaleString()}</span>
          </button>
          {loading && (
            <p className={cls.elem("message").toClassName()} role="status">
              Loading folders…
            </p>
          )}
          {error && (
            <p className={cls.elem("message").toClassName()} role="alert">
              {error}
            </p>
          )}
          <ul className={cls.elem("list").toClassName()}>
            {folders.map((folder, index) => (
              <FolderNode
                key={`${index}:${folder.prefix}`}
                folder={folder}
                selected={selected}
                disabled={disabled}
                onSelect={onSelect}
              />
            ))}
          </ul>
          <p className={cls.elem("hint").toClassName()}>
            Folders include their subfolders. Counts show all imported tasks.
          </p>
        </div>
      )}
    </nav>
  );
});

export const FolderSidebar = inject(({ store }) => ({
  store,
  view: store.currentView,
  projectId: store.project.id,
  totalTasks: store.project.task_count ?? store.project.task_number ?? 0,
}))(FolderSidebarContent);
