export const DEFAULT_ABUNDANT_MULTIPLIER = 1.5;

export type AutomaticStockState = "부족" | "주의" | "넉넉";

export type InventoryStockRange = {
  redPercent: number;
  amberPercent: number;
  greenPercent: number;
  state: AutomaticStockState;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getAutomaticStockState(
  totalStock: number,
  minimumStock: number,
  abundantMultiplier = DEFAULT_ABUNDANT_MULTIPLIER
): AutomaticStockState {
  const safeTotalStock = Math.max(Number.isFinite(totalStock) ? totalStock : 0, 0);
  const safeMinimumStock = Math.max(Number.isFinite(minimumStock) ? minimumStock : 0, 0);
  const safeMultiplier = Number.isFinite(abundantMultiplier) && abundantMultiplier > 1
    ? abundantMultiplier
    : DEFAULT_ABUNDANT_MULTIPLIER;

  if (safeTotalStock <= safeMinimumStock) return "부족";
  if (safeTotalStock <= safeMinimumStock * safeMultiplier) return "주의";
  return "넉넉";
}

export function getInventoryStockRange(
  totalStock: number,
  minimumStock: number,
  abundantMultiplier = DEFAULT_ABUNDANT_MULTIPLIER
): InventoryStockRange {
  const safeTotalStock = Math.max(Number.isFinite(totalStock) ? totalStock : 0, 0);
  const safeMinimumStock = Math.max(Number.isFinite(minimumStock) ? minimumStock : 0, 0);
  const safeMultiplier = Number.isFinite(abundantMultiplier) && abundantMultiplier > 1
    ? abundantMultiplier
    : DEFAULT_ABUNDANT_MULTIPLIER;

  if (safeTotalStock === 0) {
    return {
      redPercent: 100,
      amberPercent: 0,
      greenPercent: 0,
      state: "부족"
    };
  }

  const redEnd = clamp(safeMinimumStock, 0, safeTotalStock);
  const amberEnd = clamp(safeMinimumStock * safeMultiplier, redEnd, safeTotalStock);

  return {
    redPercent: (redEnd / safeTotalStock) * 100,
    amberPercent: ((amberEnd - redEnd) / safeTotalStock) * 100,
    greenPercent: ((safeTotalStock - amberEnd) / safeTotalStock) * 100,
    state: getAutomaticStockState(safeTotalStock, safeMinimumStock, safeMultiplier)
  };
}
