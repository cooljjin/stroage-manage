import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { X } from "lucide-react";
import { centeredWheelRow, formatWorkTime, nearestWheelRow, wheelRow, wheelValue, WORK_TIME_HOURS, WORK_TIME_MINUTES, WORK_TIME_ROW_HEIGHT, WORK_TIME_WHEEL_CYCLES } from "../lib/workTimeWheel";

type WheelHandle = { read: () => string; select: (value: string, animated?: boolean) => void };
type WheelProps = { label: string; options: readonly string[]; initialValue: string; onChange: (value: string) => void; format?: (value: string) => string };

const Wheel = forwardRef<WheelHandle, WheelProps>(function Wheel({ label, options, initialValue, onChange, format }, handle) {
  const viewport = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const touching = useRef(false);
  const moving = useRef(false);
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; }, [onChange]);
  const [activeRow, setActiveRow] = useState(() => centeredWheelRow(initialValue, options));
  const id = useId();
  const rows = Array.from({ length: options.length * WORK_TIME_WHEEL_CYCLES }, (_, index) => options[index % options.length]);

  function publish() {
    if (!viewport.current) return;
    const row = wheelRow(viewport.current.scrollTop, options.length);
    setActiveRow(row);
    change.current(options[row % options.length]);
  }
  function select(value: string, animated = true) {
    if (!viewport.current) return;
    viewport.current.scrollTo({ top: nearestWheelRow(viewport.current.scrollTop, value, options) * WORK_TIME_ROW_HEIGHT, behavior: animated ? "smooth" : "instant" });
    if (!animated) publish();
  }
  useImperativeHandle(handle, () => ({ read: () => viewport.current ? wheelValue(viewport.current.scrollTop, options) : initialValue, select }));
  useEffect(() => {
    const initialFrame = requestAnimationFrame(() => {
      if (viewport.current) viewport.current.scrollTop = centeredWheelRow(initialValue, options) * WORK_TIME_ROW_HEIGHT;
    });
    return () => cancelAnimationFrame(initialFrame);
    // Initialize once per mounted picker; scrolling never follows React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const element = viewport.current;
    function settle() {
      if (!element || touching.current) return;
      // Only recenter a fully stopped, snapped wheel. Never interrupt momentum.
      if (Math.abs(element.scrollTop / WORK_TIME_ROW_HEIGHT - Math.round(element.scrollTop / WORK_TIME_ROW_HEIGHT)) > 0.02) return;
      moving.current = false;
      clearTimeout(settleTimer.current);
      const row = wheelRow(element.scrollTop, options.length);
      if (row < options.length * 3 || row >= options.length * (WORK_TIME_WHEEL_CYCLES - 3)) {
        element.scrollTop = centeredWheelRow(options[row % options.length], options) * WORK_TIME_ROW_HEIGHT;
      }
      publish();
    }
    element?.addEventListener("scrollend", settle);
    return () => {
      element?.removeEventListener("scrollend", settle);
      clearTimeout(settleTimer.current);
      cancelAnimationFrame(frame.current);
    };
    // The mounted wheel has fixed options. Publish uses the latest callback ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function scheduleSettledCheck() {
    clearTimeout(settleTimer.current);
    const position = viewport.current?.scrollTop;
    settleTimer.current = setTimeout(() => {
      const element = viewport.current;
      if (!element || touching.current || element.scrollTop !== position) return;
      if (Math.abs(element.scrollTop / WORK_TIME_ROW_HEIGHT - Math.round(element.scrollTop / WORK_TIME_ROW_HEIGHT)) > 0.02) return;
      moving.current = false;
      const row = wheelRow(element.scrollTop, options.length);
      if (row < options.length * 3 || row >= options.length * (WORK_TIME_WHEEL_CYCLES - 3)) element.scrollTop = centeredWheelRow(options[row % options.length], options) * WORK_TIME_ROW_HEIGHT;
      publish();
    }, 250);
  }
  return <div className="min-w-0 flex-1">
    <p className="mb-2 text-center text-xs font-semibold text-slate-500">{label}</p>
    <div className="relative">
      <div ref={viewport} role="listbox" aria-label={label} aria-activedescendant={`${id}-${activeRow}`} tabIndex={0} className="work-time-wheel h-[220px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-[88px] text-center outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onPointerDown={() => { touching.current = true; }} onPointerUp={() => { touching.current = false; scheduleSettledCheck(); }} onPointerCancel={() => { touching.current = false; scheduleSettledCheck(); }} onScroll={() => {
        moving.current = true;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(publish);
        scheduleSettledCheck();
      }} onKeyDown={(event) => {
        if (!viewport.current || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const row = wheelRow(viewport.current.scrollTop, options.length);
        const target = event.key === "Home" ? centeredWheelRow(options[0], options) : event.key === "End" ? centeredWheelRow(options[options.length - 1], options) : row + (event.key === "ArrowUp" ? -1 : 1);
        viewport.current.scrollTo({ top: target * WORK_TIME_ROW_HEIGHT, behavior: "smooth" });
      }}>
        {rows.map((value, index) => <div id={`${id}-${index}`} key={index} role="option" aria-selected={activeRow === index} aria-hidden={Math.abs(index - activeRow) > 2} className={`flex h-11 snap-center items-center justify-center text-2xl tabular-nums ${activeRow === index ? "font-bold text-slate-950 dark:text-white" : "text-slate-400"}`} onClick={() => { if (!moving.current && !touching.current) select(value); }}>{format ? format(value) : value}</div>)}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[88px] bg-gradient-to-b from-white to-transparent dark:from-slate-950" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[88px] bg-gradient-to-t from-white to-transparent dark:from-slate-950" />
    </div>
  </div>;
});

function TimePicker({ label, value, onConfirm, onClose }: { label: string; value: string; onConfirm: (value: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const hours = useRef<WheelHandle>(null);
  const minutes = useRef<WheelHandle>(null);
  const titleId = useId();
  const initialHour = WORK_TIME_HOURS.includes(value.split(":")[0]) ? value.split(":")[0] : "09";
  const initialMinute = Number(value.split(":")[1]) >= 30 ? "30" : "00";
  const [hour, setHour] = useState(initialHour);
  const [minute, setMinute] = useState(initialMinute);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} aria-modal="true" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl backdrop:bg-slate-950/40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
    <header className="flex items-center justify-between"><h3 id={titleId} className="font-bold">{label}</h3><button type="button" className="touch-button icon-button" aria-label="시간 선택 취소" title="시간 선택 취소" onClick={onClose}><X size={20} /></button></header>
    <p className="mb-3 text-center text-lg font-bold tabular-nums">{formatWorkTime(`${hour}:${minute}`)}</p>
    <div className="mb-3 flex gap-2" role="group" aria-label="오전·오후">
      {["오전", "오후"].map((period, index) => <button key={period} type="button" aria-pressed={Number(hour) >= 12 === (index === 1)} className={`touch-button flex-1 rounded-lg border text-sm font-semibold ${Number(hour) >= 12 === (index === 1) ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "border-slate-200 dark:border-slate-700"}`} onClick={() => { const current = Number(hours.current?.read() ?? hour); hours.current?.select(String(current % 12 + index * 12).padStart(2, "0"), false); }}>{period}</button>)}
    </div>
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[112px] h-11 rounded-lg border-y border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950" />
      <div className="relative flex gap-3"><Wheel ref={hours} label="시" options={WORK_TIME_HOURS} initialValue={initialHour} onChange={setHour} format={(value) => String(Number(value) % 12 || 12)} /><Wheel ref={minutes} label="분" options={WORK_TIME_MINUTES} initialValue={initialMinute} onChange={setMinute} /></div>
    </div>
    <p className="my-3 text-center text-xs text-slate-500">30분 단위로 선택합니다.</p>
    <div className="flex gap-2"><button type="button" className="secondary-button flex-1" onClick={onClose}>취소</button><button type="button" className="primary-button flex-1" onClick={() => onConfirm(`${hours.current?.read() ?? hour}:${minutes.current?.read() ?? minute}`)}>확인</button></div>
  </dialog>;
}

export function WorkTimeWheel({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="min-w-0">
    <p className="text-sm font-semibold">{label}</p>
    <button type="button" className="field mt-1 w-full text-center font-semibold disabled:opacity-50" disabled={disabled} aria-label={`${label} ${formatWorkTime(value)}, 30분 단위 선택`} aria-haspopup="dialog" aria-expanded={open && !disabled} onClick={() => setOpen(true)}>{formatWorkTime(value)}</button>
    {open && !disabled && <TimePicker label={label} value={value} onClose={() => setOpen(false)} onConfirm={(selected) => { onChange(selected); setOpen(false); }} />}
  </div>;
}
