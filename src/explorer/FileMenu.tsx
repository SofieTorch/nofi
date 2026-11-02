import { mdiPencilOutline, mdiTrashCanOutline } from "@mdi/js";
import { Menu } from "../ui/Menu";

type Props = {
  /** Where it was opened (the mouse), in the window. */
  at: { x: number; y: number };
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** A file's right-click menu. */
export function FileMenu({ at, onRename, onDelete, onClose }: Props) {
  return (
    <Menu
      label="File"
      at={at}
      onClose={onClose}
      items={[
        { label: "Rename", icon: mdiPencilOutline, run: onRename },
        { label: "Delete", icon: mdiTrashCanOutline, danger: true, run: onDelete },
      ]}
    />
  );
}
