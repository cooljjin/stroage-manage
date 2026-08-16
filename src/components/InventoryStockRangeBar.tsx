import type { ChangeEvent } from "react";
import { getInventoryStockRange } from "../lib/inventoryStock";
import { formatInventoryQuantity } from "../lib/inventory";

type Props = {
  totalStock: number;
  minimumStock: number;
  abundantMultiplier: number;
  editing: boolean;
  minimumStockDraft: string;
  saving?: boolean;
  onStartEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

function finiteDraftValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function InventoryStockRangeBar({
  totalStock,
  minimumStock,
  abundantMultiplier,
  editing,
  minimumStockDraft,
  saving = false,
  onStartEdit,
  onDraftChange,
  onSave,
  onCancel
}: Props) {
  const previewMinimumStock = editing ? finiteDraftValue(minimumStockDraft, minimumStock) : minimumStock;
  const range = getInventoryStockRange(totalStock, previewMinimumStock, abundantMultiplier);
  const safeTotalStock = Math.max(Number.isFinite(totalStock) ? totalStock : 0, 0);
  const integerSliderMax = Math.floor(safeTotalStock);
  const sliderMax = Math.max(integerSliderMax, 1);
  const sliderValue = Math.min(Math.max(Math.round(previewMinimumStock), 0), integerSliderMax);

  function handleSliderChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = Number(event.target.value);
    if (Number.isFinite(nextValue)) onDraftChange(String(Math.round(nextValue)));
  }

  return (
    <div className="inventory-stock-range rounded-md border border-slate-200 p-2 text-sm dark:border-slate-800">
      <div className="flex min-h-10 items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
          총재고: <strong className="text-sm text-slate-950 dark:text-slate-100">{formatInventoryQuantity(totalStock)}</strong>
          <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
          최소재고: <strong className="text-sm text-slate-950 dark:text-slate-100">{formatInventoryQuantity(previewMinimumStock)}</strong>
        </p>
        {!editing ? (
          <button type="button" onClick={onStartEdit} className="secondary-button shrink-0 min-h-10 px-2.5 py-1 text-xs font-bold">
            수정
          </button>
        ) : null}
      </div>

      <div className="mt-1.5">
        <div
          className="relative h-3 overflow-visible rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
          role="img"
          aria-label={`총재고 ${formatInventoryQuantity(totalStock)}, 최소재고 ${formatInventoryQuantity(previewMinimumStock)}`}
        >
          <span className="absolute inset-y-0 left-0 rounded-l-full bg-red-500" style={{ width: `${range.redPercent}%` }} />
          <span className="absolute inset-y-0 bg-amber-400" style={{ left: `${range.redPercent}%`, width: `${range.amberPercent}%` }} />
          <span className="absolute inset-y-0 right-0 rounded-r-full bg-emerald-500" style={{ width: `${range.greenPercent}%` }} />
          <span
            className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-slate-950/80 dark:bg-white/80"
            style={{ left: `${Math.min(Math.max(range.redPercent, 0), 100)}%` }}
            aria-hidden="true"
          />
          {editing ? (
            <input
              className="inventory-stock-slider absolute inset-x-0 top-1/2 h-8 w-full -translate-y-1/2 cursor-ew-resize bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              type="range"
              min={0}
              max={sliderMax}
              step={1}
              value={sliderValue}
              onChange={handleSliderChange}
              aria-label="최소재고 슬라이더"
              aria-valuetext={`최소재고 ${formatInventoryQuantity(previewMinimumStock)}`}
              disabled={saving || integerSliderMax === 0}
            />
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5">
          <label className="min-w-0">
            <span className="sr-only">최소재고</span>
            <input
              className="field min-h-10 min-w-0 flex-1 px-2 py-1 text-sm font-bold tabular-nums"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={minimumStockDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              aria-label="최소재고 숫자 입력"
              disabled={saving}
            />
          </label>
          <button type="button" onClick={onSave} className="primary-button min-h-10 px-3 py-1.5 text-sm" disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
          <button type="button" onClick={onCancel} className="secondary-button min-h-10 px-3 py-1.5 text-sm" disabled={saving}>
            취소
          </button>
        </div>
      ) : null}
    </div>
  );
}
