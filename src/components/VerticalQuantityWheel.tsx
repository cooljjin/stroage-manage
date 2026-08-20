import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  MOBILE_DRAG_STEP_PX,
  MOBILE_DRAG_THRESHOLD_PX,
  MOBILE_SETTLE_DELAY_MS,
  MOBILE_SNAP_DURATION_MS,
  getVerticalDragStepCount
} from "../lib/mobileInventory";

const WHEEL_SLOT_OFFSETS = [-2, -1, 0, 1, 2] as const;
const MAX_BOUNDARY_DRAG_PX = 12;

type DragProjection = {
  value: number;
  offset: number;
};

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
  onLongPress?: () => void;
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
  onLongPress,
  onOpenKeypad,
  onDragStart,
  invertDrag = false,
  formatValue
}: Props) {
  const pointerRef = useRef<{
    id: number;
    startY: number;
    startValue: number;
    lastValue: number;
    lastOffset: number;
    dragged: boolean;
    longPressed: boolean;
  } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const snapFrameRef = useRef<number | null>(null);
  const snapEndTimerRef = useRef<number | null>(null);
  const pendingProjectionRef = useRef<DragProjection | null>(null);
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(value);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function clearSettleTimer() {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }

  function clearDragFrame() {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingProjectionRef.current = null;
  }

  function clearSnapFrame() {
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }
    if (snapEndTimerRef.current !== null) {
      window.clearTimeout(snapEndTimerRef.current);
      snapEndTimerRef.current = null;
    }
  }

  function finishTrackMotion() {
    const track = trackRef.current;
    if (!track) return;
    track.style.transitionDuration = "";
    track.style.transitionProperty = "";
    track.style.transitionTimingFunction = "";
    track.style.willChange = "";
  }

  function stopSnapMotion() {
    clearSnapFrame();
    const track = trackRef.current;
    if (!track) return;
    track.style.transitionDuration = "0ms";
    track.style.transitionProperty = "transform";
    track.style.transitionTimingFunction = "";
  }

  function setTrackOffset(offset: number) {
    const track = trackRef.current;
    if (!track) return;
    track.style.transform = `translate3d(0, ${offset}px, 0)`;
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

  function projectDrag(startY: number, currentY: number, startValue: number, snap: boolean): DragProjection {
    const distance = startY - currentY;
    const visualDistance = invertDrag ? -distance : distance;
    const stepCount = getVerticalDragStepCount(startY, currentY, snap);
    const directedStepCount = invertDrag ? -stepCount : stepCount;
    const nextValue = normalizeValue(startValue + directedStepCount);
    const appliedSteps = nextValue - startValue;
    let remainder = visualDistance - appliedSteps * MOBILE_DRAG_STEP_PX;
    const continuousValue = startValue + visualDistance / MOBILE_DRAG_STEP_PX;
    const beyondBoundary = continuousValue < min || (max !== undefined && continuousValue > max);

    if (beyondBoundary) {
      remainder = Math.sign(remainder) * Math.min(MAX_BOUNDARY_DRAG_PX, Math.abs(remainder) * 0.35);
    }

    return {
      value: nextValue,
      offset: remainder
    };
  }

  function applyDragProjection(projection: DragProjection) {
    if (projection.value !== displayValueRef.current) {
      displayValueRef.current = projection.value;
      setDisplayValue(projection.value);
      onDraftChange(projection.value);
    }
    setTrackOffset(-projection.offset);
  }

  function scheduleDragProjection(projection: DragProjection) {
    pendingProjectionRef.current = projection;
    if (dragFrameRef.current !== null) return;

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pendingProjection = pendingProjectionRef.current;
      pendingProjectionRef.current = null;
      if (pendingProjection) applyDragProjection(pendingProjection);
    });
  }

  function settleDrag(projection: DragProjection) {
    clearDragFrame();
    stopSnapMotion();
    applyDragProjection(projection);

    const track = trackRef.current;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!track || prefersReducedMotion || Math.abs(projection.offset) < 0.01) {
      setTrackOffset(0);
      finishTrackMotion();
      commitValue(projection.value);
      return;
    }

    track.style.willChange = "transform";
    void track.offsetHeight;
    snapFrameRef.current = window.requestAnimationFrame(() => {
      snapFrameRef.current = null;
      track.style.transitionProperty = "transform";
      track.style.transitionTimingFunction = "cubic-bezier(0.22, 1, 0.36, 1)";
      track.style.transitionDuration = `${MOBILE_SNAP_DURATION_MS}ms`;
      setTrackOffset(0);
      snapEndTimerRef.current = window.setTimeout(() => {
        snapEndTimerRef.current = null;
        finishTrackMotion();
      }, MOBILE_SNAP_DURATION_MS + 40);
    });
    commitValue(projection.value);
  }

  function getPreviewValue(offset: number): number | null {
    const previewValue = displayValue + offset;
    if (previewValue < min || (max !== undefined && previewValue > max)) return null;
    return previewValue;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    clearSettleTimer();
    clearDragFrame();
    stopSnapMotion();
    setTrackOffset(0);
    trackRef.current?.style.setProperty("will-change", "transform");
    pointerRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startValue: displayValueRef.current,
      lastValue: displayValueRef.current,
      lastOffset: 0,
      dragged: false,
      longPressed: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (onLongPress) {
      longPressTimerRef.current = window.setTimeout(() => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId || pointer.dragged) return;
        pointer.longPressed = true;
        longPressTimerRef.current = null;
        onLongPress();
      }, 700);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId || disabled) return;
    if (pointer.longPressed) return;
    const distance = Math.abs(pointer.startY - event.clientY);
    if (distance >= MOBILE_DRAG_THRESHOLD_PX && !pointer.dragged) {
      pointer.dragged = true;
      clearLongPressTimer();
      onDragStart?.();
    }
    if (!pointer.dragged) return;
    event.preventDefault();

    const projection = projectDrag(pointer.startY, event.clientY, pointer.startValue, false);
    pointer.lastValue = projection.value;
    pointer.lastOffset = projection.offset;
    scheduleDragProjection(projection);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    clearLongPressTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointer.longPressed) {
      clearDragFrame();
      setTrackOffset(0);
      finishTrackMotion();
      return;
    }
    if (pointer.dragged) {
      const projection = projectDrag(pointer.startY, event.clientY, pointer.startValue, true);
      pointer.lastValue = projection.value;
      pointer.lastOffset = projection.offset;
      settleDrag(projection);
    } else {
      clearDragFrame();
      setTrackOffset(0);
      finishTrackMotion();
      onOpenKeypad();
    }
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    clearSettleTimer();
    clearLongPressTimer();
    clearDragFrame();
    stopSnapMotion();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointer.longPressed) {
      setTrackOffset(0);
      finishTrackMotion();
      return;
    }
    if (pointer.dragged) {
      settleDrag({ value: pointer.lastValue, offset: pointer.lastOffset });
    } else {
      setTrackOffset(0);
      finishTrackMotion();
      if (pointer.startValue !== displayValueRef.current) {
        displayValueRef.current = pointer.startValue;
        setDisplayValue(pointer.startValue);
        onDraftChange(pointer.startValue);
      }
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = (event.key === "ArrowUp" ? 1 : -1) * (invertDrag ? -1 : 1);
      const nextValue = normalizeValue(displayValueRef.current + delta);
      displayValueRef.current = nextValue;
      setDisplayValue(nextValue);
      onDraftChange(nextValue);
      onCommit(nextValue);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenKeypad();
    }
  }

  useEffect(() => () => {
    clearSettleTimer();
    clearLongPressTimer();
    clearDragFrame();
    clearSnapFrame();
  }, []);

  useEffect(() => {
    if (pointerRef.current || value === displayValueRef.current) return;
    displayValueRef.current = value;
    setDisplayValue(value);
  }, [value]);

  return (
    <button
      type="button"
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={displayValue}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      title="위아래로 밀어 수량 조정 · 탭하여 직접 입력 · 길게 눌러 현재 수량 실사"
      className="relative flex min-h-44 min-w-0 touch-none select-none flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-50 px-2 py-2 text-center transition-colors active:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-brand-950/40 sm:min-h-48 sm:px-3 sm:py-4"
      style={{ WebkitUserSelect: "none", userSelect: "none" }}
    >
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300">{label}</span>
        <span className="whitespace-nowrap text-[9px] font-bold text-brand-600 dark:text-brand-300">위아래로 밀기</span>
      </div>
      <ChevronUp aria-hidden="true" className="mt-1 shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} />
      <div className="relative mt-0.5 h-24 w-full max-w-[8rem] overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden"
          style={{
            contain: "paint",
            maskImage: "linear-gradient(to bottom, transparent 0%, black 34%, black 66%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 34%, black 66%, transparent 100%)"
          }}
        >
          <div
            ref={trackRef}
            className="absolute inset-x-0 text-brand-600 dark:text-brand-300"
            style={{
              top: -MOBILE_DRAG_STEP_PX,
              transform: "translate3d(0, 0, 0)"
            }}
          >
            {WHEEL_SLOT_OFFSETS.map((offset) => {
              const previewValue = getPreviewValue(offset);
              return (
                <span key={offset} className="block h-8 truncate text-2xl font-black leading-8 tabular-nums tracking-tight sm:text-3xl">
                  {previewValue === null ? "·" : formatValue(previewValue)}
                </span>
              );
            })}
          </div>
        </div>
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-8 h-8 border-y border-slate-200 dark:border-slate-700" />
      </div>
      <ChevronDown aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} />
      {hint ? <span className="mt-0.5 line-clamp-2 text-[9px] font-semibold leading-tight text-slate-500 dark:text-slate-400 sm:mt-1 sm:text-[10px] sm:leading-snug">{hint}</span> : null}
    </button>
  );
}
