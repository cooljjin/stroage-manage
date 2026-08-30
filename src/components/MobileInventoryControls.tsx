import { useEffect, useRef, useState } from "react";
import { Check, Redo2, Undo2 } from "lucide-react";
import { formatInventoryQuantity } from "../lib/inventory";
import { buildAuditTarget, buildAutoAdjustmentTarget, buildMoveTarget, clampMobileQuantity, type MobileInventoryTarget } from "../lib/mobileInventory";
import type { Location, MobileInventoryMode } from "../types/domain";
import { VerticalQuantityWheel, type PeerWheelAnimation, type WheelInputKind } from "./VerticalQuantityWheel";

type LocationCheckInfo = {
  checkedAt: string | null;
  staffName: string | null;
};

type LocationCheckDates = {
  warehouse: LocationCheckInfo;
  store: LocationCheckInfo;
};

type Props = {
  mode: MobileInventoryMode;
  warehouseQty: number;
  storeQty: number;
  confirmedWarehouseQty: number;
  confirmedStoreQty: number;
  autoBaselineWarehouseQty: number;
  autoBaselineStoreQty: number;
  lastInventoryCheckDates: LocationCheckDates;
  disabled?: boolean;
  rebaseDisabled?: boolean;
  autoRebaseSequence?: number;
  saveState: "idle" | "dragging" | "pending" | "saved" | "error";
  saveError?: string;
  savedAtLabel?: string | null;
  saveStatusLabel?: "서버에 저장됨" | "수정 시점" | "수량 확인 완료";
  canUndo: boolean;
  canRedo: boolean;
  onModeChange: (mode: MobileInventoryMode) => void;
  onDraftChange: (target: MobileInventoryTarget) => void;
  onCommit: (target: MobileInventoryTarget) => void;
  onRebaseAutoBaseline: (location: Location) => void;
  onInventoryCheck: (location: Location) => void;
  onOpenKeypad: (target: "warehouse" | "store") => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

type PeerAnimationState = {
  location: Location;
  instruction: PeerWheelAnimation;
};

type MoveWheelValueKind = "absolute" | "delta";

function formatCheckLabel(info: LocationCheckInfo): string {
  if (!info.checkedAt) return "마지막 실사 -";
  const date = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(new Date(info.checkedAt));
  return `마지막 실사 ${date}${info.staffName ? ` · ${info.staffName}` : ""}`;
}

export function MobileInventoryControls({
  mode,
  warehouseQty,
  storeQty,
  confirmedWarehouseQty,
  confirmedStoreQty,
  autoBaselineWarehouseQty,
  autoBaselineStoreQty,
  lastInventoryCheckDates,
  disabled = false,
  rebaseDisabled = false,
  autoRebaseSequence,
  saveState,
  saveError,
  savedAtLabel,
  saveStatusLabel = "서버에 저장됨",
  canUndo,
  canRedo,
  onModeChange,
  onDraftChange,
  onCommit,
  onRebaseAutoBaseline,
  onInventoryCheck,
  onOpenKeypad,
  onSave,
  onUndo,
  onRedo
}: Props) {
  const [peerAnimation, setPeerAnimation] = useState<PeerAnimationState | null>(null);
  const peerAnimationSequenceRef = useRef(0);
  const isMove = mode === "move";
  const warehousePeerAnimation = isMove && peerAnimation?.location === "창고" ? peerAnimation.instruction : null;
  const storePeerAnimation = isMove && peerAnimation?.location === "매장" ? peerAnimation.instruction : null;
  useEffect(() => {
    if (!isMove) setPeerAnimation(null);
  }, [isMove]);
  const totalQty = clampMobileQuantity(confirmedWarehouseQty + confirmedStoreQty);

  function buildAutoAdjustment(location: Location, delta: number) {
    const target = buildAutoAdjustmentTarget(location, delta, autoBaselineWarehouseQty, autoBaselineStoreQty);
    return {
      ...target,
      warehouseQty: location === "창고" ? target.warehouseQty : warehouseQty,
      storeQty: location === "매장" ? target.storeQty : storeQty
    };
  }
  function getMoveBaseline(location: Location) {
    return location === "창고" ? confirmedWarehouseQty : confirmedStoreQty;
  }

  function getMoveDelta(location: Location, quantity: number): number {
    return quantity - getMoveBaseline(location);
  }

  function getMoveAbsoluteValue(location: Location, delta: number): number {
    return clampMobileQuantity(getMoveBaseline(location) + delta);
  }

  function getMoveDeltaMax(location: Location) {
    return location === "창고" ? confirmedStoreQty : confirmedWarehouseQty;
  }

  function handleLocationDraft(location: Location, nextValue: number, inputKind?: WheelInputKind, valueKind: MoveWheelValueKind = "delta") {
    const absoluteNextValue = mode === "move" && valueKind === "delta" ? getMoveAbsoluteValue(location, nextValue) : nextValue;
    const target = mode === "move"
      ? buildMoveTarget(location, absoluteNextValue, confirmedWarehouseQty, confirmedStoreQty)
      : mode === "audit"
        ? buildAuditTarget(location, nextValue, warehouseQty, storeQty)
        : buildAutoAdjustment(location, nextValue);

    if (mode === "move" && inputKind) {
      const peerLocation = location === "창고" ? "매장" : "창고";
      const peerCurrentQuantity = peerLocation === "창고" ? warehouseQty : storeQty;
      const peerTargetQuantity = peerLocation === "창고" ? target.warehouseQty : target.storeQty;
      const fromValue = getMoveDelta(peerLocation, peerCurrentQuantity);
      const toValue = getMoveDelta(peerLocation, peerTargetQuantity);
      if (fromValue !== toValue) {
        peerAnimationSequenceRef.current += 1;
        setPeerAnimation({
          location: peerLocation,
          instruction: { sequence: peerAnimationSequenceRef.current, fromValue, toValue }
        });
      }
    }

    onDraftChange(target);
  }

  function handleLocationCommit(location: Location, nextValue: number, valueKind: MoveWheelValueKind = "delta") {
    const absoluteNextValue = mode === "move" && valueKind === "delta" ? getMoveAbsoluteValue(location, nextValue) : nextValue;
    const target = mode === "move"
      ? buildMoveTarget(location, absoluteNextValue, confirmedWarehouseQty, confirmedStoreQty)
      : mode === "audit"
        ? buildAuditTarget(location, nextValue, warehouseQty, storeQty)
        : buildAutoAdjustment(location, nextValue);
    onCommit(target);
  }

  function formatSignedQuantity(value: number) {
    return `${value > 0 ? "+" : ""}${formatInventoryQuantity(value)}`;
  }

  function renderMoveLocation(location: Location) {
    const isWarehouse = location === "창고";
    const currentQty = isWarehouse ? warehouseQty : storeQty;
    const baselineQty = getMoveBaseline(location);
    const delta = getMoveDelta(location, currentQty);
    const deltaMax = getMoveDeltaMax(location);
    const hint = formatCheckLabel(isWarehouse ? lastInventoryCheckDates.warehouse : lastInventoryCheckDates.store);
    const keypadTarget = isWarehouse ? "warehouse" : "store";
    const peerAnimationForLocation = isWarehouse ? warehousePeerAnimation : storePeerAnimation;

    return (
      <div className="grid min-w-0 gap-1.5 sm:gap-3">
        <VerticalQuantityWheel
          label={location}
          labelClassName="text-sm font-extrabold"
          value={currentQty}
          min={0}
          max={totalQty}
          invertDrag
          compact
          disabled={disabled}
          ariaLabel={`${location} ${formatInventoryQuantity(currentQty)}`}
          formatValue={formatInventoryQuantity}
          onDraftChange={(value, inputKind) => handleLocationDraft(location, value, inputKind, "absolute")}
          onCommit={(value) => handleLocationCommit(location, value, "absolute")}
          onLongPress={() => onInventoryCheck(location)}
          onOpenKeypad={() => onOpenKeypad(keypadTarget)}
          onDragStart={() => undefined}
        />
        <VerticalQuantityWheel
          label=""
          value={delta}
          min={-baselineQty}
          max={deltaMax}
          invertDrag
          reverseDisplayOrder
          snapFractionalValueOnStep
          disabled={disabled}
          hint={hint}
          ariaLabel={`${location} 조정값 ${formatSignedQuantity(delta)}, 현재 재고 ${formatInventoryQuantity(currentQty)}`}
          formatValue={formatSignedQuantity}
          peerAnimation={peerAnimationForLocation}
          showDragHint={false}
          onDraftChange={(value, inputKind) => handleLocationDraft(location, value, inputKind)}
          onCommit={(value) => handleLocationCommit(location, value)}
          onLongPress={() => onInventoryCheck(location)}
          onOpenKeypad={() => onOpenKeypad(keypadTarget)}
          onDragStart={() => undefined}
        />
      </div>
    );
  }

  function renderAutoLocation(location: Location) {
    const isWarehouse = location === "창고";
    const currentQty = isWarehouse ? warehouseQty : storeQty;
    const baselineQty = isWarehouse ? autoBaselineWarehouseQty : autoBaselineStoreQty;
    const delta = (isWarehouse ? warehouseQty : storeQty) - baselineQty;
    const hint = formatCheckLabel(isWarehouse ? lastInventoryCheckDates.warehouse : lastInventoryCheckDates.store);
    const keypadTarget = isWarehouse ? "warehouse" : "store";

    return (
      <div className="grid min-w-0 gap-1.5 sm:gap-3">
        <button
          type="button"
          onClick={() => onRebaseAutoBaseline(location)}
          disabled={disabled || rebaseDisabled}
          className="rounded-xl min-h-[68px] border-2 border-slate-200 bg-slate-50 px-3 py-2 text-center transition-colors active:bg-brand-50 sm:min-h-[72px] dark:border-slate-800 dark:bg-slate-900 dark:active:bg-brand-950/40"
          aria-label={`${location} ${formatInventoryQuantity(currentQty)}, 조정 기준으로 재설정`}
          title="현재 수량을 조정 기준으로 재설정"
        >
          <p className="text-sm font-extrabold text-black dark:text-black">{location}</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-black dark:text-black sm:text-3xl">{formatInventoryQuantity(currentQty)}</p>
        </button>
        <VerticalQuantityWheel
          label=""
          value={delta}
          min={-baselineQty}
          invertDrag
          reverseDisplayOrder
          snapFractionalValueOnStep
          authoritativeRebaseSequence={autoRebaseSequence}
          disabled={disabled}
          hint={hint}
          ariaLabel={`${location} 조정값 ${formatSignedQuantity(delta)}, 현재 재고 ${formatInventoryQuantity(currentQty)}`}
          formatValue={formatSignedQuantity}
          showDragHint={false}
          onDraftChange={(value) => handleLocationDraft(location, value)}
          onCommit={(value) => handleLocationCommit(location, value)}
          onLongPress={() => onInventoryCheck(location)}
          onOpenKeypad={() => onOpenKeypad(keypadTarget)}
          onDragStart={() => undefined}
        />
      </div>
    );
  }

  return (
    <section className="panel p-1.5 sm:p-4" aria-label="모바일 재고 작업">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900 sm:gap-1.5 sm:p-1">
        {([
          ["auto", "입고, 출고"],
          ["move", "이동"],
          ["audit", "실사"]
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            disabled={disabled}
            className={`touch-button h-10 min-h-10 rounded-md px-2 text-sm font-extrabold sm:h-auto sm:min-h-11 ${mode === value ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"}`}
            aria-pressed={mode === value}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-3">
        {mode === "auto" ? (
          <>
            {renderAutoLocation("창고")}
            {renderAutoLocation("매장")}
          </>
        ) : mode === "move" ? (
          <>
            {renderMoveLocation("창고")}
            {renderMoveLocation("매장")}
          </>
        ) : (
          <>
            <VerticalQuantityWheel
              label="창고"
              labelClassName="text-sm font-extrabold"
              value={warehouseQty}
              disabled={disabled}
              hint={formatCheckLabel(lastInventoryCheckDates.warehouse)}
              showDragHint={false}
              ariaLabel={`창고 수량 ${formatInventoryQuantity(warehouseQty)}`}
              formatValue={formatInventoryQuantity}
              onDraftChange={(value, inputKind) => handleLocationDraft("창고", value, inputKind)}
              onCommit={(value) => handleLocationCommit("창고", value)}
              onLongPress={() => onInventoryCheck("창고")}
              onOpenKeypad={() => onOpenKeypad("warehouse")}
              onDragStart={() => undefined}
            />
            <VerticalQuantityWheel
              label="매장"
              labelClassName="text-sm font-extrabold"
              value={storeQty}
              disabled={disabled}
              hint={formatCheckLabel(lastInventoryCheckDates.store)}
              showDragHint={false}
              ariaLabel={`매장 수량 ${formatInventoryQuantity(storeQty)}`}
              formatValue={formatInventoryQuantity}
              onDraftChange={(value, inputKind) => handleLocationDraft("매장", value, inputKind)}
              onCommit={(value) => handleLocationCommit("매장", value)}
              onLongPress={() => onInventoryCheck("매장")}
              onOpenKeypad={() => onOpenKeypad("store")}
              onDragStart={() => undefined}
            />
          </>
        )}
      </div>

      <div className="mt-1 flex min-h-10 items-center gap-1.5 sm:mt-3 sm:gap-2">
        <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-800 sm:px-3 sm:py-2 sm:text-sm" role="status" aria-live="polite">
          {saveState === "dragging" ? <span className="block w-full truncate font-semibold text-slate-500 dark:text-slate-400">수량을 조정하는 중...</span> : null}
          {saveState === "pending" ? <span className="block w-full truncate font-semibold text-brand-700 dark:text-brand-100">재고를 저장하는 중...</span> : null}
          {saveState === "saved" ? <span className="flex min-w-0 items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300" title={savedAtLabel ? `${saveStatusLabel} · ${savedAtLabel}` : saveStatusLabel}><Check className="shrink-0" size={16} /><span className="truncate">{saveStatusLabel}{savedAtLabel ? ` · ${savedAtLabel}` : ""}</span></span> : null}
          {saveState === "error" ? <span className="block w-full truncate font-semibold text-rose-700 dark:text-rose-300" title={saveError ?? "저장하지 못했습니다."}>{saveError ?? "저장하지 못했습니다."}</span> : null}
          {saveState === "idle" ? <span className="block w-full truncate font-semibold text-slate-500 dark:text-slate-400">{savedAtLabel ? `편집 시점 ${savedAtLabel}` : mode === "auto" ? "위로 밀면 입고, 아래로 밀면 출고" : mode === "move" ? "총재고 안에서 창고·매장 수량을 자유롭게 조정하세요." : "창고와 매장 수량을 각각 실사하세요."}</span> : null}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || saveState === "dragging" || saveState === "pending"}
          className="primary-button inline-flex min-h-10 items-center justify-center px-3 py-1 text-sm font-extrabold sm:min-h-11"
        >
          {saveState === "pending" ? "저장 중..." : "저장"}
        </button>
        <button type="button" onClick={onUndo} disabled={disabled || !canUndo || saveState === "dragging" || saveState === "pending" || saveState === "error"} className="secondary-button inline-flex min-h-10 min-w-10 items-center justify-center px-2 py-1 sm:min-h-11" aria-label="뒤로가기" title="뒤로가기">
          <Undo2 size={18} />
        </button>
        <button type="button" onClick={onRedo} disabled={disabled || !canRedo || saveState === "dragging" || saveState === "pending" || saveState === "error"} className="secondary-button inline-flex min-h-10 min-w-10 items-center justify-center px-2 py-1 sm:min-h-11" aria-label="되돌리기" title="되돌리기">
          <Redo2 size={18} />
        </button>
      </div>
    </section>
  );
}
