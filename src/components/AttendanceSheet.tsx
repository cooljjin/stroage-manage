import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";

type Props = { title: string; onClose: () => void; onBack?: () => void; children: ReactNode };

export function AttendanceSheet({ title, onClose, onBack, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby="attendance-sheet-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/50 dark:text-slate-100">
    <section className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-xl dark:bg-slate-950 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        {onBack && <button type="button" className="touch-button icon-button" aria-label="뒤로" title="뒤로" onClick={onBack}><ChevronLeft size={20} /></button>}
        <h2 id="attendance-sheet-title" className="min-w-0 flex-1 break-words font-bold">{title}</h2>
        <button type="button" autoFocus className="touch-button icon-button" aria-label="팝업 닫기" title="닫기" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
    </section>
  </dialog>;
}
