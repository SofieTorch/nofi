import { mdiFilePlusOutline, mdiFolderPlusOutline, mdiPencilOutline, mdiTrashCanOutline } from "@mdi/js";
import { Menu } from "../ui/Menu";

type Props = {
  /** Where it was opened (the mouse), in the window. */
  at: { x: number; y: number };
  /** What was right-clicked: a file, a folder, or the empty space below the files. */
  on: "file" | "folder" | "space";
  onNewNote: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** The right-click menu of a file, a folder (new notes and folders go in it), or the empty space (they go at the top). */
export function FileMenu({ at, on, onNewNote, onNewFolder, onRename, onDelete, onClose }: Props) {
  const making = [
    { label: "New note", icon: mdiFilePlusOutline, run: onNewNote },
    { label: "New folder", icon: mdiFolderPlusOutline, run: onNewFolder },
  ];
  const changing = [
    { label: "Rename", icon: mdiPencilOutline, run: onRename },
    { label: "Delete", icon: mdiTrashCanOutline, danger: true, run: onDelete },
  ];
  return (
    <Menu
      label={on === "folder" ? "Folder" : on === "file" ? "File" : "Files"}
      at={at}
      onClose={onClose}
      items={on === "file" ? changing : on === "folder" ? [...making, ...changing] : making}
    />
  );
}
