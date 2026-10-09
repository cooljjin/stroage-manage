import { useRef } from "react";
import type { Dispatch, MouseEvent, PointerEvent, SetStateAction } from "react";
import { applyScheduleDateRange, calendarDateAtPoint, hasExceededScheduleDragThreshold, toggleScheduleDate, type ScheduleDragMode } from "../lib/scheduleDateSelection";

type Gesture = { pointerId: number; startDate: string; currentDate: string; startX: number; startY: number; initialSelection: string[]; dragMode: ScheduleDragMode; dragging: boolean };

export function useCalendarDateSelection(selectedDates: string[], setSelectedDates: Dispatch<SetStateAction<string[]>>) {
  const gesture = useRef<Gesture | null>(null);

  function onClickDate(date: string, event: MouseEvent<HTMLButtonElement>) {
    if (event.detail !== 0) return;
    setSelectedDates((current) => toggleScheduleDate(current, date));
  }

  function onPointerDownDate(date: string, event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const initialSelection = [...selectedDates];
    gesture.current = {
      pointerId: event.pointerId,
      startDate: date,
      currentDate: date,
      startX: event.clientX,
      startY: event.clientY,
      initialSelection,
      dragMode: initialSelection.includes(date) ? "deselect" : "select",
      dragging: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const date = calendarDateAtPoint(event.currentTarget, event.clientX, event.clientY);
    if (date) active.currentDate = date;
    if (!active.dragging && !hasExceededScheduleDragThreshold(active.startX, active.startY, event.clientX, event.clientY)) return;
    active.dragging = true;
    setSelectedDates(applyScheduleDateRange(active.initialSelection, active.startDate, active.currentDate, active.dragMode));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const date = calendarDateAtPoint(event.currentTarget, event.clientX, event.clientY);
    if (date) active.currentDate = date;
    if (!active.dragging && hasExceededScheduleDragThreshold(active.startX, active.startY, event.clientX, event.clientY)) active.dragging = true;
    setSelectedDates(active.dragging
      ? applyScheduleDateRange(active.initialSelection, active.startDate, active.currentDate, active.dragMode)
      : toggleScheduleDate(active.initialSelection, active.startDate));
    gesture.current = null;
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setSelectedDates(active.initialSelection);
    gesture.current = null;
  }

  function clearGesture() {
    gesture.current = null;
  }

  return { onClickDate, onPointerDownDate, onPointerMove, onPointerUp, onPointerCancel, clearGesture };
}
