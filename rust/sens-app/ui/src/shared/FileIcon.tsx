import { fileIcon } from "./fileIcons";

// A file's type icon, in its own colours (identity.md §6.5).
export function FileIcon({ path }: { path: string }) {
  return (
    <span className="glyph">
      <img src={fileIcon(path)} alt="" draggable={false} />
    </span>
  );
}
