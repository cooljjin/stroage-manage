import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { MOBILE_DRAG_THRESHOLD_PX, MOBILE_SETTLE_DELAY_MS, quantityFromVerticalDrag } from "../lib/mobileInventory";

type Props = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
  ariaLabel: string;
  onDraftChange: (value: number) => void;
  onCommit: (value: number) => void;
  onOpenKeypad: () => void;
  onDragStart?: () => void;
  invertDrag?: boolean;
  formatValue: (value: number) => string;
};

export function VerticalQuantityWheel({
  label,
  value,
  min = 0,
  max,
  disabled = false,
  hint,
  ariaLabel,
  onDraftChange,
  onCommit,
  onOpenKeypad,
  onDragStart,
  invertDrag = false,
  formatValue
}: Props) {
  const pointerRef = useRef<{ id: number; startY: number; startValue: number; lastValue: number; dragged: boolean } | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  function clearSettleTimer() {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }

  function commitValue(nextValue: number) {
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      onCommit(nextValue);
    }, MOBILE_SETTLE_DELAY_MS);
  }

  function normalizeValue(nextValue: number): number {
    return Math.max(min, Math.min(max ?? Number.POSITIVE_INFINITY, nextValue));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    pointerRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startValue: value,
      lastValue: value,
      dragged: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId || disabled) return;
    const distance = Math.abs(pointer.startY - event.clientY);
    if (distance >= MOBILE_DRAG_THRESHOLD_PX && !pointer.dragged) {
      pointer.dragged = true;
      onDragStart?.();
    }
    if (!pointer.dragged) return;

    const rawValue = quantityFromVerticalDrag(pointer.startValue, pointer.startY, event.clientY, max);
    const nextValue = normalizeValue(invertDrag
      ? Math.max(min, pointer.startValue - (rawValue - pointer.startValue))
      : rawValue);
    pointer.lastValue = nextValue;
    onDraftChange(nextValue);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointer.dragged) {
      const rawValue = quantityFromVerticalDrag(pointer.startValue, pointer.startY, event.clientY, max);
      const nextValue = normalizeValue(invertDrag ? pointer.startValue - (rawValue - pointer.startValue) : rawValue);
      pointer.lastValue = nextValue;
      onDraftChange(nextValue);
      commitValue(nextValue);
    } else {
      onOpenKeypad();
    }
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    clearSettleTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointer.dragged) {
      onDraftChange(pointer.lastValue);
      commitValue(pointer.lastValue);
    } else {
      onDraftChange(pointer.startValue);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = (event.key === "ArrowUp" ? 1 : -1) * (invertDrag ? -1 : 1);
      const nextValue = normalizeValue(value + delta);
      onDraftChange(nextValue);
      onCommit(nextValue);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenKeypad();
    }
  }

  useEffect(() => () => clearSettleTimer(), []);

  return (
    <button
      type="button"
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      title="위아래로 밀어 수량 조정 · 탭하여 직접 입력"
      className="relative flex min-h-24 min-w-0 touch-none select-none flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-50 px-1.5 py-1.5 text-center transition-colors active:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-brand-950/40 sm:min-h-40 sm:px-3 sm:py-4"
      style={{ WebkitUserSelect: "none", userSelect: "none" }}
    >
      <ChevronUp aria-hidden="true" className="shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} />
      <span className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-2xl font-black tabular-nums tracking-tight text-slate-950 dark:text-slate-100 sm:mt-1 sm:text-4xl">{formatValue(value)}</span>
      <ChevronDown aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} />
      {hint ? <span className="mt-0.5 line-clamp-2 text-[9px] font-semibold leading-tight text-slate-500 dark:text-slate-400 sm:mt-1 sm:text-[10px] sm:leading-snug">{hint}</span> : null}
    </button>
  );
}
