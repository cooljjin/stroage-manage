import type { Location, MobileInventoryMode } from "../types/domain";

export const MOBILE_DRAG_STEP_PX = 32;
export const MOBILE_DRAG_THRESHOLD_PX = 8;
export const MOBILE_SETTLE_DELAY_MS = 300;
export const MOBILE_SNAP_DURATION_MS = 180;

export type MobileMoveDirection = "warehouse-to-store" | "store-to-warehouse";
export type MobileScanMode = "auto" | "audit";

export function normalizeMobileScanMode(value: unknown): MobileScanMode {
  return value === "audit" ? "audit" : "auto";
}

export type MobileInventoryTarget = {
  mode: MobileInventoryMode;
  targetLocation: Location | null;
  moveDirection: MobileMoveDirection | null;
  warehouseQty: number;
  storeQty: number;
};

export type MobileInventoryEditPoint = {
  warehouseQty: number;
  storeQty: number;
  editAt: string;
  mode: MobileInventoryMode;
  targetLocation: Location | null;
  moveDirection: MobileMoveDirection | null;
};

export function clampMobileQuantity(value: number, max = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value * 10000) / 10000));
}

export function parseMobileQuantity(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!/^\d*(\.\d{0,4})?$/.test(normalized) || normalized === "." || normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 99999999.9999
    ? clampMobileQuantity(parsed)
    : null;
}

export function parseSignedMobileQuantity(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!/^[+-]?\d*(\.\d{0,4})?$/.test(normalized) || normalized === "-" || normalized === "+" || normalized === "." || normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 99999999.9999
    ? Math.round(parsed * 10000) / 10000
    : null;
}

export function getVerticalWheelSlotValue(
  value: number,
  offset: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  reverseDisplayOrder = false
): number | null {
  const nextValue = value + offset * (reverseDisplayOrder ? -1 : 1);
  return nextValue < min || nextValue > max ? null : nextValue;
}

export function getVerticalWheelTrackOffset(offset: number, reverseDisplayOrder = false): number {
  return -offset * (reverseDisplayOrder ? -1 : 1);
}

export function getVerticalDragStepCount(startY: number, currentY: number, snap = false): number {
  const rawStepCount = (startY - currentY) / MOBILE_DRAG_STEP_PX;
  if (!snap) return Math.trunc(rawStepCount);
  return rawStepCount >= 0 ? Math.floor(rawStepCount + 0.5) : Math.ceil(rawStepCount - 0.5);
}

export function getVerticalWheelStep(deltaY: number): number {
  return deltaY < 0 ? 1 : deltaY > 0 ? -1 : 0;
}

export function getVerticalWheelValueAfterSteps(value: number, stepCount: number, snapFractionalValue = false): number {
  if (!snapFractionalValue || stepCount === 0 || Number.isInteger(value)) return value + stepCount;
  return Math.trunc(value) + stepCount;
}

export function quantityFromVerticalDrag(startValue: number, startY: number, currentY: number, max = Number.POSITIVE_INFINITY): number {
  const stepCount = getVerticalDragStepCount(startY, currentY);
  return clampMobileQuantity(startValue + stepCount, max);
}

export function getMoveDirectionForQuantities(
  warehouseQty: number,
  storeQty: number,
  confirmedWarehouseQty: number,
  confirmedStoreQty: number
): MobileMoveDirection | null {
  const storeDelta = storeQty - confirmedStoreQty;
  if (storeDelta > 0) return "warehouse-to-store";
  if (storeDelta < 0) return "store-to-warehouse";

  const warehouseDelta = warehouseQty - confirmedWarehouseQty;
  if (warehouseDelta > 0) return "store-to-warehouse";
  if (warehouseDelta < 0) return "warehouse-to-store";
  return null;
}

export function buildMoveTarget(
  location: Location,
  nextQuantity: number,
  confirmedWarehouseQty: number,
  confirmedStoreQty: number
): MobileInventoryTarget {
  const totalQty = clampMobileQuantity(confirmedWarehouseQty + confirmedStoreQty);
  const adjustedQuantity = clampMobileQuantity(nextQuantity, totalQty);
  const warehouseQty = location === "창고"
    ? adjustedQuantity
    : clampMobileQuantity(totalQty - adjustedQuantity);
  const storeQty = location === "매장"
    ? adjustedQuantity
    : clampMobileQuantity(totalQty - adjustedQuantity);
  const moveDirection = getMoveDirectionForQuantities(
    warehouseQty,
    storeQty,
    confirmedWarehouseQty,
    confirmedStoreQty
  );

  return {
    mode: "move",
    targetLocation: moveDirection === "warehouse-to-store" ? "창고" : moveDirection === "store-to-warehouse" ? "매장" : null,
    moveDirection,
    warehouseQty,
    storeQty
  };
}

export function hasMobileInventoryChange(
  warehouseQty: number,
  storeQty: number,
  confirmedWarehouseQty: number,
  confirmedStoreQty: number
): boolean {
  return warehouseQty !== confirmedWarehouseQty || storeQty !== confirmedStoreQty;
}

export function buildAutoTarget(
  location: Location,
  nextQuantity: number,
  warehouseQty: number,
  storeQty: number
): MobileInventoryTarget {
  return {
    mode: "auto",
    targetLocation: location,
    moveDirection: null,
    warehouseQty: location === "창고" ? clampMobileQuantity(nextQuantity) : warehouseQty,
    storeQty: location === "매장" ? clampMobileQuantity(nextQuantity) : storeQty
  };
}

export function buildAutoAdjustmentTarget(
  location: Location,
  delta: number,
  baselineWarehouseQty: number,
  baselineStoreQty: number
): MobileInventoryTarget {
  const baselineQty = location === "창고" ? baselineWarehouseQty : baselineStoreQty;
  return buildAutoTarget(
    location,
    clampMobileQuantity(baselineQty + delta),
    baselineWarehouseQty,
    baselineStoreQty
  );
}

export function buildAuditTarget(
  location: Location,
  nextQuantity: number,
  warehouseQty: number,
  storeQty: number
): MobileInventoryTarget {
  return {
    mode: "audit",
    targetLocation: location,
    moveDirection: null,
    warehouseQty: location === "창고" ? clampMobileQuantity(nextQuantity) : warehouseQty,
    storeQty: location === "매장" ? clampMobileQuantity(nextQuantity) : storeQty
  };
}

export function buildMobileHistoryTarget(
  currentWarehouseQty: number,
  currentStoreQty: number,
  editPoint: MobileInventoryEditPoint,
  operationPoint: MobileInventoryEditPoint = editPoint
): MobileInventoryTarget {
  const warehouseChanged = editPoint.warehouseQty !== currentWarehouseQty;
  const storeChanged = editPoint.storeQty !== currentStoreQty;

  if (operationPoint.mode === "move") {
    const location: Location = storeChanged ? "매장" : "창고";
    const nextQuantity = location === "매장" ? editPoint.storeQty : editPoint.warehouseQty;
    return buildMoveTarget(location, nextQuantity, currentWarehouseQty, currentStoreQty);
  }

  const targetLocation = operationPoint.targetLocation ?? editPoint.targetLocation ?? (warehouseChanged ? "창고" : "매장");
  return {
    mode: operationPoint.mode,
    targetLocation,
    moveDirection: null,
    warehouseQty: clampMobileQuantity(editPoint.warehouseQty),
    storeQty: clampMobileQuantity(editPoint.storeQty)
  };
}
