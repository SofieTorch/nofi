import { Icon } from "@mdi/react";

type Props = {
  /** Material Design icon path, from @mdi/js. */
  icon: string;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** For toggle buttons: whether the option is currently on. */
  pressed?: boolean;
};

export function IconButton({ icon, label, onClick, pressed }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`flex size-7 items-center justify-center rounded-md transition-colors hover:bg-neutral-100 ${
        pressed === false ? "text-neutral-400" : "text-neutral-700"
      }`}
    >
      <Icon path={icon} size="18px" />
    </button>
  );
}
