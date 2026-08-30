import { Menu } from "lucide-react";
import { StocklyStackIcon } from "./StocklyStackIcon";

type Props = {
  open: boolean;
  onClick: () => void;
};

export function StocklyMenuButton({ open, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`touch-button no-press-scale inline-flex h-10 w-10 items-center justify-center rounded-md ${open ? "bg-brand-50 dark:bg-brand-950" : ""}`}
      aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
      aria-expanded={open}
      title="메뉴"
    >
      <Menu size={22} aria-hidden="true" />
    </button>
  );
}

export function StocklyCharacterMenuButton({ open, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`no-press-scale inline-flex h-10 w-10 translate-y-1.5 shrink-0 items-center justify-center rounded-md bg-transparent ${open ? "bg-brand-50 dark:bg-brand-950" : ""}`}
      aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
      aria-expanded={open}
      title="메뉴"
    >
      <StocklyStackIcon open={open} className="h-9 w-9" />
    </button>
  );
}
