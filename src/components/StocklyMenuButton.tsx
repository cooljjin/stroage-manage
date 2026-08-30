type Props = {
  open: boolean;
  onClick: () => void;
};

export function StocklyMenuButton({ open, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`touch-button no-press-scale inline-flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-bold ${open ? "bg-brand-50 dark:bg-brand-950" : ""}`}
      aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
      aria-expanded={open}
      title="메뉴"
    >
      메뉴
    </button>
  );
}
