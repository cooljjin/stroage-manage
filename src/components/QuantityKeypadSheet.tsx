import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { parseMobileQuantity, parseSignedMobileQuantity } from "../lib/mobileInventory";

type Props = {
  open: boolean;
  title: string;
  initialValue: number;
  min?: number;
  max?: number;
  signed?: boolean;
  onClose: () => void;
  onConfirm: (value: number) => void;
  formatValue: (value: number) => string;
};

export function QuantityKeypadSheet({ open, title, initialValue, min = 0, max, signed = false, onClose, onConfirm, formatValue }: Props) {
  const [draft, setDraft] = useState(String(initialValue));
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(String(initialValue));
      setError("");
    }
  }, [initialValue, open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  function confirm() {
    const value = signed ? parseSignedMobileQuantity(draft) : parseMobileQuantity(draft);
    if (value === null || value < min || (max !== undefined && value > max)) {
      const upperBound = max !== undefined ? `부터 ${formatValue(max)}까지` : " 이상";
      setError(`${formatValue(min)}${upperBound} 입력해 주세요.`);
      return;
    }
    onConfirm(value);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/55 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full rounded-t-2xl bg-white p-3 shadow-2xl dark:bg-slate-950 sm:max-w-md sm:rounded-2xl sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} className="touch-button icon-button h-10 min-h-10 w-10 min-w-10 sm:h-auto sm:min-h-11 sm:min-w-11" aria-label="닫기" title="닫기">
            <X size={19} />
          </button>
        </div>
        <label className="mt-3 block sm:mt-4">
          <span className="mb-1 block text-sm font-bold">{signed ? "조정값" : "수량"}</span>
          <input
            autoFocus
            className="field text-center text-3xl font-black tabular-nums"
            type="text"
            inputMode={signed ? "text" : "decimal"}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value.replace(",", "."));
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") confirm();
            }}
            aria-label="수량 입력"
          />
        </label>
        {error ? <p className="mt-2 text-sm font-semibold text-rose-700 dark:text-rose-300" role="alert">{error}</p> : null}
        <button type="button" onClick={confirm} className="primary-button mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 py-2 sm:mt-4">
          <Check size={19} />
          적용
        </button>
      </div>
    </div>
  );
}
