import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { MOBILE_DRAG_STEP_PX, MOBILE_DRAG_THRESHOLD_PX, MOBILE_SETTLE_DELAY_MS, MOBILE_SNAP_DURATION_MS, getVerticalDragStepCount, getVerticalWheelSlotValue, getVerticalWheelStep, getVerticalWheelTrackOffset, getVerticalWheelValueAfterSteps } from "../lib/mobileInventory";

const SLOT_OFFSETS = [-2, -1, 0, 1, 2] as const;
const MAX_BOUNDARY_DRAG_PX = 12;
const AUTOMATIC_SPRING_STIFFNESS = 0.16;
const AUTOMATIC_SPRING_DAMPING = 0.72;
const AUTOMATIC_SPRING_MAX_OVERSHOOT_ROWS = 0.2;
const AUTOMATIC_SPRING_POSITION_EPSILON = 0.015;
const AUTOMATIC_SPRING_VELOCITY_EPSILON = 0.015;
const AUTOMATIC_SPRING_MAX_DURATION_MS = 320;
const AUTOMATIC_SPRING_FRAME_MS = 1000 / 60;

export type WheelInputKind = "pointer" | "wheel" | "keyboard";

export type PeerWheelAnimation = {
  sequence: number;
  fromValue: number;
  toValue: number;
};

type Props = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
  ariaLabel: string;
  onDraftChange: (value: number, inputKind?: WheelInputKind) => void;
  onCommit: (value: number) => void;
  onLongPress?: () => void;
  onOpenKeypad: () => void;
  onDragStart?: () => void;
  peerAnimation?: PeerWheelAnimation | null;
  compact?: boolean;
  showDragHint?: boolean;
  authoritativeRebaseSequence?: number;
  invertDrag?: boolean;
  reverseDisplayOrder?: boolean;
  snapFractionalValueOnStep?: boolean;
  formatValue: (value: number) => string;
};

type Projection = { value: number; offset: number };
type PointerState = {
  id: number;
  startY: number;
  startValue: number;
  startOffset: number;
  lastProjection: Projection;
  dragged: boolean;
  longPressed: boolean;
};

type AutomaticSpringMotion = {
  id: number;
  targetValue: number;
  position: number;
  velocity: number;
  lastTime: number;
  anchorValue: number;
  direction: number;
  currentBaseValue: number;
  maxOvershoot: number;
  overshootGuarded: boolean;
  startedBeyondTarget: boolean;
  authoritativeSequence: number | null;
  peerSequence: number | null;
};

export function VerticalQuantityWheel({
  label, value, min = 0, max, disabled = false, hint, ariaLabel,
  onDraftChange, onCommit, onLongPress, onOpenKeypad, onDragStart, peerAnimation,
  compact = false, showDragHint = true, authoritativeRebaseSequence, invertDrag = false, reverseDisplayOrder = false, snapFractionalValueOnStep = false, formatValue
}: Props) {
  const pointerRef = useRef<PointerState | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const snapFrameRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | null>(null);
  const automaticFrameRef = useRef<number | null>(null);
  const automaticTimerRef = useRef<number | null>(null);
  const pendingProjectionRef = useRef<Projection | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const lastAuthoritativeRebaseSequenceRef = useRef(authoritativeRebaseSequence ?? 0);
  const lastPeerSequenceRef = useRef(0);
  const automaticMotionIdRef = useRef(0);
  const automaticMotionRef = useRef<AutomaticSpringMotion | null>(null);
  const peerMotionRef = useRef<number | null>(null);
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

  function clearAutomaticFrame() {
    if (automaticFrameRef.current !== null) {
      window.cancelAnimationFrame(automaticFrameRef.current);
      automaticFrameRef.current = null;
    }
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

  function finishAutomaticMotion(id: number) {
    const motion = automaticMotionRef.current;
    if (!motion || motion.id !== id) return;
    automaticMotionRef.current = null;
    clearAutomaticFrame();
    clearTimer(automaticTimerRef);
    if (motion.peerSequence !== null && peerMotionRef.current === motion.peerSequence) peerMotionRef.current = null;
    setDisplayValueLocal(motion.targetValue, true);
    setTrackOffset(0);
    finishMotion();
  }

  function cancelAutomaticMotion(preserveVisualPosition = false): Projection | null {
    const motion = automaticMotionRef.current;
    if (!motion) return null;
    automaticMotionRef.current = null;
    clearAutomaticFrame();
    clearTimer(automaticTimerRef);
    stopMotion();
    if (motion.peerSequence !== null && peerMotionRef.current === motion.peerSequence) peerMotionRef.current = null;
    const visualOffset = (motion.position - motion.currentBaseValue) * MOBILE_DRAG_STEP_PX;
    setDisplayValueLocal(motion.currentBaseValue, true);
    setTrackOffset(preserveVisualPosition ? getVerticalWheelTrackOffset(visualOffset, reverseDisplayOrder) : 0);
    finishMotion();
    return preserveVisualPosition ? { value: motion.currentBaseValue, offset: visualOffset } : null;
  }

  function cancelPeerMotion() {
    const sequence = peerMotionRef.current;
    if (sequence === null) return;
    if (automaticMotionRef.current?.peerSequence === sequence) {
      cancelAutomaticMotion();
      return;
    }
    peerMotionRef.current = null;
    stopMotion();
    setTrackOffset(0);
    finishMotion();
  }

  function setTrackOffset(offset: number) {
    if (trackRef.current) trackRef.current.style.transform = `translate3d(0, ${offset}px, 0)`;
  }

  function normalize(nextValue: number) {
    return Math.max(min, Math.min(max ?? Number.POSITIVE_INFINITY, nextValue));
  }

  function setDisplayValueLocal(nextValue: number, syncVisualRebase = false) {
    if (nextValue === displayValueRef.current) return;
    displayValueRef.current = nextValue;
    if (syncVisualRebase) {
      flushSync(() => setDisplayValue(nextValue));
    } else {
      setDisplayValue(nextValue);
    }
  }

  function setLocalValue(nextValue: number, syncVisualRebase = false, inputKind?: WheelInputKind) {
    if (nextValue === displayValueRef.current) return;
    pendingValueRef.current = nextValue === value ? null : nextValue;
    setDisplayValueLocal(nextValue, syncVisualRebase);
    onDraftChange(nextValue, inputKind);
  }

  function updateAutomaticVisual(motion: AutomaticSpringMotion) {
    const travelledRows = (motion.position - motion.anchorValue) * motion.direction;
    const completedRows = Math.floor(Math.max(0, travelledRows + 0.0000001));
    const baseValue = motion.anchorValue + motion.direction * completedRows;
    if (baseValue !== motion.currentBaseValue) {
      motion.currentBaseValue = baseValue;
      // Only crossed rows update React-owned labels. Fractional movement stays
      // on the composited track, so the component does not render every frame.
      setDisplayValueLocal(baseValue, true);
    }
    setTrackOffset(getVerticalWheelTrackOffset((motion.position - baseValue) * MOBILE_DRAG_STEP_PX, reverseDisplayOrder));
  }

  function retargetAutomaticMotion(targetValue: number) {
    const motion = automaticMotionRef.current;
    if (!motion || motion.targetValue === targetValue) return;

    const nextDirection = Math.sign(targetValue - motion.position);
    if (nextDirection === 0) {
      motion.targetValue = targetValue;
      finishAutomaticMotion(motion.id);
      return;
    }

    motion.targetValue = targetValue;
    motion.anchorValue = motion.currentBaseValue;
    motion.direction = nextDirection;
    motion.maxOvershoot = Math.min(
      AUTOMATIC_SPRING_MAX_OVERSHOOT_ROWS,
      Math.abs(targetValue - motion.position) * 0.12
    );
    motion.overshootGuarded = false;
    motion.startedBeyondTarget = motion.direction * (motion.position - targetValue) > 0;
    // Keep momentum for same-direction updates. On a direction change, remove
    // only the opposing momentum so the new spring can turn without sailing
    // past the new target by several rows.
    if (motion.velocity !== 0 && Math.sign(motion.velocity) !== nextDirection) motion.velocity = 0;
    const maxRetargetVelocity = Math.max(0.35, Math.abs(targetValue - motion.position) * 0.9);
    if (Math.abs(motion.velocity) > maxRetargetVelocity) motion.velocity = Math.sign(motion.velocity) * maxRetargetVelocity;
    motion.lastTime = 0;
    clearTimer(automaticTimerRef);
    automaticTimerRef.current = window.setTimeout(() => finishAutomaticMotion(motion.id), AUTOMATIC_SPRING_MAX_DURATION_MS);
  }

  function startAutomaticMotion(
    targetValue: number,
    authoritativeSequence: number | null = null,
    peerSequence: number | null = null
  ) {
    const existingMotion = automaticMotionRef.current;
    if (existingMotion) {
      if (existingMotion.peerSequence !== null && peerMotionRef.current === existingMotion.peerSequence && peerSequence === null) peerMotionRef.current = null;
      existingMotion.authoritativeSequence = authoritativeSequence;
      existingMotion.peerSequence = peerSequence;
      retargetAutomaticMotion(targetValue);
      return;
    }

    const fromValue = displayValueRef.current;
    const direction = Math.sign(targetValue - fromValue);
    const motion: AutomaticSpringMotion = {
      id: automaticMotionIdRef.current + 1,
      targetValue,
      position: fromValue,
      velocity: 0,
      lastTime: 0,
      anchorValue: fromValue,
      direction,
      currentBaseValue: fromValue,
      maxOvershoot: Math.min(AUTOMATIC_SPRING_MAX_OVERSHOOT_ROWS, Math.abs(targetValue - fromValue) * 0.12),
      overshootGuarded: false,
      startedBeyondTarget: false,
      authoritativeSequence,
      peerSequence
    };
    automaticMotionIdRef.current = motion.id;
    automaticMotionRef.current = motion;

    const track = trackRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stopMotion();
    if (!track || reduceMotion || direction === 0) {
      finishAutomaticMotion(motion.id);
      return;
    }

    track.style.transition = "none";
    track.style.willChange = "transform";
    function frame(now: number) {
      const activeMotion = automaticMotionRef.current;
      if (!activeMotion || activeMotion.id !== motion.id) return;
      const frameScale = activeMotion.lastTime === 0
        ? 1
        : Math.min(2, Math.max(0.5, (now - activeMotion.lastTime) / AUTOMATIC_SPRING_FRAME_MS));
      activeMotion.lastTime = now;

      activeMotion.velocity = (
        activeMotion.velocity
        + (activeMotion.targetValue - activeMotion.position) * AUTOMATIC_SPRING_STIFFNESS * frameScale
      ) * Math.pow(AUTOMATIC_SPRING_DAMPING, frameScale);
      let nextPosition = activeMotion.position + activeMotion.velocity * frameScale;
      const passedTarget = activeMotion.direction * (nextPosition - activeMotion.targetValue) > 0;
      if (activeMotion.startedBeyondTarget) {
        if (!passedTarget) activeMotion.startedBeyondTarget = false;
      } else if (passedTarget) {
        activeMotion.overshootGuarded = true;
      }
      if (activeMotion.overshootGuarded && activeMotion.direction * (nextPosition - activeMotion.targetValue) > activeMotion.maxOvershoot) {
        nextPosition = activeMotion.targetValue + activeMotion.direction * activeMotion.maxOvershoot;
        activeMotion.velocity = 0;
      }
      activeMotion.position = nextPosition;
      updateAutomaticVisual(activeMotion);

      if (
        Math.abs(activeMotion.targetValue - activeMotion.position) <= AUTOMATIC_SPRING_POSITION_EPSILON
        && Math.abs(activeMotion.velocity) <= AUTOMATIC_SPRING_VELOCITY_EPSILON
      ) {
        finishAutomaticMotion(activeMotion.id);
        return;
      }
      automaticFrameRef.current = window.requestAnimationFrame(frame);
    }

    automaticFrameRef.current = window.requestAnimationFrame(frame);
    automaticTimerRef.current = window.setTimeout(() => finishAutomaticMotion(motion.id), AUTOMATIC_SPRING_MAX_DURATION_MS);
  }

  function projection(startY: number, currentY: number, startValue: number, snap: boolean, startOffset = 0): Projection {
    const distance = (startY - currentY) * (invertDrag ? -1 : 1) + startOffset;
    const stepCount = getVerticalDragStepCount(startY, currentY, snap) * (invertDrag ? -1 : 1);
    const nextValue = normalize(getVerticalWheelValueAfterSteps(startValue, stepCount, snapFractionalValueOnStep));
    let offset = distance - (nextValue - startValue) * MOBILE_DRAG_STEP_PX;
    const continuousValue = startValue + distance / MOBILE_DRAG_STEP_PX;
    if (continuousValue < min || (max !== undefined && continuousValue > max)) {
      offset = Math.sign(offset) * Math.min(MAX_BOUNDARY_DRAG_PX, Math.abs(offset) * 0.35);
    }
    return { value: nextValue, offset };
  }

  function applyProjection(next: Projection, inputKind: WheelInputKind) {
    // Rebase the React-owned slot text before resetting the composited track.
    // Keeping both writes in this rAF prevents the prior slot set from being
    // painted in the center band at an exact drag-step boundary.
    setLocalValue(next.value, true, inputKind);
    setTrackOffset(getVerticalWheelTrackOffset(next.offset, reverseDisplayOrder));
  }

  function scheduleProjection(next: Projection) {
    pendingProjectionRef.current = next;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pending = pendingProjectionRef.current;
      pendingProjectionRef.current = null;
      if (pending) applyProjection(pending, "pointer");
    });
  }

  function scheduleCommit(nextValue: number) {
    clearTimer(settleTimerRef);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      onCommit(nextValue);
    }, MOBILE_SETTLE_DELAY_MS);
  }

  function settle(next: Projection, inputKind: WheelInputKind = "pointer") {
    clearDragFrame();
    stopMotion();
    applyProjection(next, inputKind);
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

  function restoreControlledDisplayValue() {
    if (pendingValueRef.current === null && value !== displayValueRef.current) setDisplayValueLocal(value, true);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    clearTimer(settleTimerRef);
    clearDragFrame();
    const automaticHandoff = cancelAutomaticMotion(true);
    cancelPeerMotion();
    stopMotion();
    const startValue = automaticHandoff?.value ?? displayValueRef.current;
    const startOffset = automaticHandoff?.offset ?? 0;
    setTrackOffset(getVerticalWheelTrackOffset(startOffset, reverseDisplayOrder));
    pointerRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startValue,
      startOffset,
      lastProjection: { value: startValue, offset: startOffset },
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
    pointer.lastProjection = projection(pointer.startY, event.clientY, pointer.startValue, false, pointer.startOffset);
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
      restoreControlledDisplayValue();
      return;
    }
    if (!pointer.dragged) {
      clearDragFrame();
      setTrackOffset(0);
      finishMotion();
      restoreControlledDisplayValue();
      if (!cancelled) onOpenKeypad();
      return;
    }
    settle(cancelled ? pointer.lastProjection : projection(pointer.startY, event.clientY, pointer.startValue, true, pointer.startOffset));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      cancelAutomaticMotion();
      cancelPeerMotion();
      const delta = (event.key === "ArrowUp" ? 1 : -1) * (invertDrag ? -1 : 1);
      const nextValue = normalize(getVerticalWheelValueAfterSteps(displayValueRef.current, delta, snapFractionalValueOnStep));
      setLocalValue(nextValue, false, "keyboard");
      onCommit(nextValue);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenKeypad();
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLButtonElement>) {
    if (disabled) return;
    const step = getVerticalWheelStep(event.deltaY) * (invertDrag ? -1 : 1);
    const nextValue = normalize(getVerticalWheelValueAfterSteps(displayValueRef.current, step, snapFractionalValueOnStep));
    if (step === 0 || nextValue === displayValueRef.current) return;
    event.preventDefault();
    cancelAutomaticMotion();
    cancelPeerMotion();
    settle({ value: nextValue, offset: 0 }, "wheel");
  }

  useEffect(() => {
    if (authoritativeRebaseSequence === undefined || authoritativeRebaseSequence <= lastAuthoritativeRebaseSequenceRef.current) return;
    lastAuthoritativeRebaseSequenceRef.current = authoritativeRebaseSequence;

    const targetValue = value;
    pendingValueRef.current = null;
    pointerRef.current = null;
    clearLongPress();
    clearDragFrame();
    cancelPeerMotion();
    // The controlled value is already the logical target. Only the visual
    // wheel position is retargeted so a baseline reset does not commit drafts.
    startAutomaticMotion(targetValue, authoritativeRebaseSequence);
  // The expected controlled target is held until this visual-only timeline finishes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authoritativeRebaseSequence, value, reverseDisplayOrder]);

  useEffect(() => {
    if (!peerAnimation || peerAnimation.sequence <= lastPeerSequenceRef.current) return;
    lastPeerSequenceRef.current = peerAnimation.sequence;
    if (disabled || peerAnimation.fromValue === peerAnimation.toValue || pointerRef.current) return;

    cancelAutomaticMotion();
    clearDragFrame();
    stopMotion();
    pendingValueRef.current = null;
    peerMotionRef.current = peerAnimation.sequence;
    // Peer changes are visual-only too. Start from the producer's source value
    // and let the same spring loop handle interruption and retargeting.
    setDisplayValueLocal(peerAnimation.fromValue, true);

    startAutomaticMotion(peerAnimation.toValue, null, peerAnimation.sequence);
  // Motion helpers intentionally stay local so they share this wheel's refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, peerAnimation, reverseDisplayOrder]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    if (snapFrameRef.current !== null) window.cancelAnimationFrame(snapFrameRef.current);
    if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
    if (automaticFrameRef.current !== null) window.cancelAnimationFrame(automaticFrameRef.current);
    if (automaticTimerRef.current !== null) window.clearTimeout(automaticTimerRef.current);
    automaticMotionRef.current = null;
    peerMotionRef.current = null;
  }, []);

  useEffect(() => {
    if (pointerRef.current) return;
    const activeMotion = automaticMotionRef.current;
    const peerOwnsAutomaticMotion = activeMotion?.peerSequence === peerMotionRef.current;
    if (peerMotionRef.current !== null && !peerOwnsAutomaticMotion && value !== displayValueRef.current) cancelPeerMotion();
    if (pendingValueRef.current !== null) {
      if (value === pendingValueRef.current) pendingValueRef.current = null;
      else return;
    }
    if (automaticMotionRef.current) {
      if (value === automaticMotionRef.current.targetValue) return;
      startAutomaticMotion(value);
      return;
    }
    if (value !== displayValueRef.current) startAutomaticMotion(value);
  // Reconciliation must use the current imperative peer-motion refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function previewValue(offset: number) {
    return getVerticalWheelSlotValue(displayValue, offset, min, max, reverseDisplayOrder);
  }

  return (
    <button type="button" role="spinbutton" aria-label={ariaLabel} aria-valuemin={min} aria-valuemax={max} aria-valuenow={displayValue} disabled={disabled} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => releasePointer(event, false)} onPointerCancel={(event) => releasePointer(event, true)} onWheel={handleWheel} onContextMenu={(event) => event.preventDefault()} onKeyDown={handleKeyDown} title="위아래로 밀어 수량 조정 · 탭하여 직접 입력 · 길게 눌러 현재 수량 실사" className={`relative flex min-w-0 touch-none select-none flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-50 text-center transition-colors active:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-brand-950/40 ${compact ? "min-h-[68px] px-3 py-2 sm:min-h-[72px]" : "min-h-44 px-2 py-2 sm:min-h-48 sm:px-3 sm:py-4"}`} style={{ WebkitUserSelect: "none", userSelect: "none" }}>
      <div className={`flex w-full items-center gap-1 ${compact || !showDragHint ? "justify-center" : "justify-between"}`}><span className="text-xs font-extrabold text-black dark:text-black">{label}</span>{showDragHint && !compact ? <span className="whitespace-nowrap text-[9px] font-bold text-black dark:text-black">위아래로 밀기</span> : null}</div>
      {compact ? <ChevronUp aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 mx-auto text-brand-600 dark:text-brand-300" size={8} strokeWidth={2.75} /> : null}
      {!compact ? <ChevronUp aria-hidden="true" className="mt-1 shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} /> : null}
      <div className={`relative w-full max-w-[8rem] overflow-hidden ${compact ? "h-8" : "mt-0.5 h-24"}`}>
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden" style={{ contain: "paint", maskImage: compact ? "linear-gradient(to bottom, black 0%, black 100%)" : "linear-gradient(to bottom, transparent 0%, black 34%, black 66%, transparent 100%)", WebkitMaskImage: compact ? "linear-gradient(to bottom, black 0%, black 100%)" : "linear-gradient(to bottom, transparent 0%, black 34%, black 66%, transparent 100%)" }}>
          <div ref={trackRef} className="absolute inset-x-0 text-black dark:text-black" style={{ top: compact ? -MOBILE_DRAG_STEP_PX * 2 : -MOBILE_DRAG_STEP_PX, transform: "translate3d(0, 0, 0)" }}>
            {SLOT_OFFSETS.map((offset) => { const nextValue = previewValue(offset); return <span key={offset} className={`block h-8 truncate font-black leading-8 tabular-nums tracking-tight ${compact ? "text-2xl" : "text-2xl sm:text-3xl"}`}>{nextValue === null ? "·" : formatValue(nextValue)}</span>; })}
          </div>
        </div>
        {!compact ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-8 h-8 border-y border-slate-200 dark:border-slate-700" /> : null}
      </div>
      {compact ? <ChevronDown aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 mx-auto text-brand-600 dark:text-brand-300" size={8} strokeWidth={2.75} /> : null}
      {!compact ? <ChevronDown aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" size={15} strokeWidth={2.75} /> : null}
      {hint && !compact ? <span className="mt-0.5 line-clamp-2 text-[9px] font-semibold leading-tight text-black dark:text-black sm:mt-1 sm:text-[10px] sm:leading-snug">{hint}</span> : null}
    </button>
  );
}
