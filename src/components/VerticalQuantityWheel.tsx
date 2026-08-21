import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { MOBILE_DRAG_STEP_PX, MOBILE_DRAG_THRESHOLD_PX, MOBILE_SETTLE_DELAY_MS, MOBILE_SNAP_DURATION_MS, getVerticalDragStepCount } from "../lib/mobileInventory";

const SLOT_OFFSETS = [-2, -1, 0, 1, 2] as const;
const MAX_BOUNDARY_DRAG_PX = 12;

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

type Projection = { value: number; offset: number };
type PointerState = {
  id: number;
  startY: number;
  startValue: number;
  lastProjection: Projection;
  dragged: boolean;
  longPressed: boolean;
};

export function VerticalQuantityWheel({
  label, value, min = 0, max, disabled = false, hint, ariaLabel,
  onDraftChange, onCommit, onLongPress, onOpenKeypad, onDragStart,
  invertDrag = false, formatValue
}: Props) {
  const pointerRef = useRef<PointerState | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const snapFrameRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | null>(null);
  const pendingProjectionRef = useRef<Projection | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(value);

  function clearTimer(ref: React.MutableRefObject<number | null>) {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  }

  function clearDragFrame() {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingProjectionRef.current = null;
  }

  function finishMotion() {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = "";
    track.style.willChange = "";
  }

  function stopMotion() {
    if (snapFrameRef.current !== null) {
      window.cancelAnimationFrame(snapFrameRef.current);
      snapFrameRef.current = null;
    }
    clearTimer(snapTimerRef);
    const track = trackRef.current;
    if (track) track.style.transition = "none";
  }

  function setTrackOffset(offset: number) {
    if (trackRef.current) trackRef.current.style.transform = `translate3d(0, ${offset}px, 0)`;
  }

  function normalize(nextValue: number) {
    return Math.max(min, Math.min(max ?? Number.POSITIVE_INFINITY, nextValue));
  }

  function setLocalValue(nextValue: number, syncVisualRebase = false) {
    if (nextValue === displayValueRef.current) return;
    displayValueRef.current = nextValue;
    pendingValueRef.current = nextValue === value ? null : nextValue;
    if (syncVisualRebase) {
      flushSync(() => setDisplayValue(nextValue));
    } else {
      setDisplayValue(nextValue);
    }
    onDraftChange(nextValue);
  }

  function projection(startY: number, currentY: number, startValue: number, snap: boolean): Projection {
    const distance = (startY - currentY) * (invertDrag ? -1 : 1);
    const stepCount = getVerticalDragStepCount(startY, currentY, snap) * (invertDrag ? -1 : 1);
    const nextValue = normalize(startValue + stepCount);
    let offset = distance - (nextValue - startValue) * MOBILE_DRAG_STEP_PX;
    const continuousValue = startValue + distance / MOBILE_DRAG_STEP_PX;
    if (continuousValue < min || (max !== undefined && continuousValue > max)) {
      offset = Math.sign(offset) * Math.min(MAX_BOUNDARY_DRAG_PX, Math.abs(offset) * 0.35);
    }
    return { value: nextValue, offset };
  }

  function applyProjection(next: Projection) {
    // Rebase the React-owned slot text before resetting the composited track.
    // Keeping both writes in this rAF prevents the prior slot set from being
    // painted in the center band at an exact drag-step boundary.
    setLocalValue(next.value, true);
    setTrackOffset(-next.offset);
  }

  function scheduleProjection(next: Projection) {
    pendingProjectionRef.current = next;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pending = pendingProjectionRef.current;
      pendingProjectionRef.current = null;
      if (pending) applyProjection(pending);
    });
  }

  function scheduleCommit(nextValue: number) {
    clearTimer(settleTimerRef);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      onCommit(nextValue);
    }, MOBILE_SETTLE_DELAY_MS);
  }

  function settle(next: Projection) {
    clearDragFrame();
    stopMotion();
    applyProjection(next);
    const track = trackRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!track || reduceMotion || Math.abs(next.offset) < 0.01) {
      setTrackOffset(0);
      finishMotion();
    } else {
      track.style.willChange = "transform";
      void track.offsetHeight;
      snapFrameRef.current = window.requestAnimationFrame(() => {
        snapFrameRef.current = null;
        track.style.transition = `transform ${MOBILE_SNAP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        setTrackOffset(0);
        snapTimerRef.current = window.setTimeout(finishMotion, MOBILE_SNAP_DURATION_MS + 40);
      });
    }
    scheduleCommit(next.value);
  }

  function clearLongPress() {
    clearTimer(longPressTimerRef);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    clearTimer(settleTimerRef);
    clearDragFrame();
    stopMotion();
    setTrackOffset(0);
    pointerRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startValue: displayValueRef.current,
      lastProjection: { value: displayValueRef.current, offset: 0 },
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
    if (!pointer || pointer.id !== event.pointerId || disabled || pointer.longPressed) return;
    if (Math.abs(pointer.startY - event.clientY) >= MOBILE_DRAG_THRESHOLD_PX && !pointer.dragged) {
      pointer.dragged = true;
      clearLongPress();
      onDragStart?.();
    }
    if (!pointer.dragged) return;
    event.preventDefault();
    pointer.lastProjection = projection(pointer.startY, event.clientY, pointer.startValue, false);
    scheduleProjection(pointer.lastProjection);
  }

  function releasePointer(event: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    clearLongPress();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointer.longPressed) {
      clearDragFrame();
      setTrackOffset(0);
      finishMotion();
      return;
    }
    if (!pointer.dragged) {
      clearDragFrame();
      setTrackOffset(0);
      finishMotion();
      if (!cancelled) onOpenKeypad();
      return;
    }
    settle(cancelled ? pointer.lastProjection : projection(pointer.startY, event.clientY, pointer.startValue, true));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = (event.key === "ArrowUp" ? 1 : -1) * (invertDrag ? -1 : 1);
      const nextValue = normalize(displayValueRef.current + delta);
      setLocalValue(nextValue);
      onCommit(nextValue);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenKeypad();
    }
  }

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    if (snapFrameRef.current !== null) window.cancelAnimationFrame(snapFrameRef.current);
    if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
  }, []);

  useEffect(() => {
    if (pointerRef.current) return;
    if (pendingValueRef.current !== null) {
      if (value === pendingValueRef.current) pendingValueRef.current = null;
      else return;
    }
    if (value !== displayValueRef.current) {
      displayValueRef.current = value;
      setDisplayValue(value);
    }
  }, [value]);

  function previewValue(offset: number) {
    const nextValue = displayValue + offset;
    return nextValue < min || (max !== undefined && nextValue > max) ? null : nextValue;
  }

  return (
    <button type="button" role="spinbutton" aria-label={ariaLabel} aria-valuemin={min} aria-valuemax={max} aria-valuenow={displayValue} disabled={disabled} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => releasePointer(event, false)} onPointerCancel={(event) => releasePointer(event, true)} onContextMenu={(event) => event.preventDefault()} onKeyDown={handleKeyDown} title="위아래로 밀어 수량 조정 · 탭하여 직접 입력 · 길게 눌러 현재 수량 실사" className="relative flex min-h-44 min-w-0 touch-none select-none flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-50 px-2 py-2 text-center transition-colors active:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-brand-950/40 sm:min-h-48 sm:px-3 sm:py-4" style={{ WebkitUserSelect: "none", userSelect: "none" }}>
      <div className="flex w-full items-center justify-between gap-1"><span className="text-xs font-extrabold text-slate-600 dark:text-slate-300">{label}</span><span className="whitespace-nowrap text-[9px] font-bold text-brand-600 dark:text-brand-300">위아래로 밀기</span></div>
      <ChevronUp aria-hidden="true" className="mt-1 shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} />
      <div className="relative mt-0.5 h-24 w-full max-w-[8rem] overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden" style={{ contain: "paint", maskImage: "linear-gradient(to bottom, transparent 0%, black 34%, black 66%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 34%, black 66%, transparent 100%)" }}>
          <div ref={trackRef} className="absolute inset-x-0 text-brand-600 dark:text-brand-300" style={{ top: -MOBILE_DRAG_STEP_PX, transform: "translate3d(0, 0, 0)" }}>
            {SLOT_OFFSETS.map((offset) => { const nextValue = previewValue(offset); return <span key={offset} className="block h-8 truncate text-2xl font-black leading-8 tabular-nums tracking-tight sm:text-3xl">{nextValue === null ? "·" : formatValue(nextValue)}</span>; })}
          </div>
        </div>
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-8 h-8 border-y border-slate-200 dark:border-slate-700" />
      </div>
      <ChevronDown aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} />
      {hint ? <span className="mt-0.5 line-clamp-2 text-[9px] font-semibold leading-tight text-slate-500 dark:text-slate-400 sm:mt-1 sm:text-[10px] sm:leading-snug">{hint}</span> : null}
    </button>
  );
}
