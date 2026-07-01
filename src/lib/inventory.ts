import type { Inventory, InventoryItem, Product } from "../types/domain";

type ProductWithInventory = Product & {
  inventory: Inventory[] | Inventory | null;
};

function toFiniteQuantity(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function formatInventoryQuantity(value: number | string | null | undefined): string {
  const numericValue = toFiniteQuantity(value);
  return numericValue.toLocaleString("ko-KR", {
    minimumFractionDigits: Number.isInteger(numericValue) ? 0 : 1,
    maximumFractionDigits: 4
  });
}

export function normalizeInventoryItem(row: ProductWithInventory): InventoryItem {
  const inventory = Array.isArray(row.inventory) ? row.inventory[0] ?? null : row.inventory;
  const warehouse_qty = toFiniteQuantity(inventory?.warehouse_qty);
  const store_qty = toFiniteQuantity(inventory?.store_qty);
  const total_stock = warehouse_qty + store_qty;

  return {
    ...row,
    order_completed: row.order_completed ?? false,
    urgent_order_requested: row.urgent_order_requested ?? false,
    urgent_order_quantity: row.urgent_order_quantity ?? null,
    fresh_order_selected: row.fresh_order_selected ?? false,
    fresh_order_selected_at: row.fresh_order_selected_at ?? null,
    receipt_check_only: row.receipt_check_only ?? false,
    status_enabled: row.status_enabled ?? false,
    stock_status: row.stock_status ?? null,
    inventory,
    warehouse_qty,
    store_qty,
    total_stock,
    is_low_stock: row.receipt_check_only ? false : row.status_enabled ? row.stock_status === "발주 필요" : total_stock <= row.minimum_stock
  };
}

export function formatLogContent(log: {
  action: string;
  source_location: string | null;
  destination_location: string | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  quantity: number | null;
  note: string | null;
}): string {
  if (log.action === "프랩 제조") {
    const sign = log.destination_location ? "+" : "-";
    return `${sign}${log.quantity ?? 0}`;
  }

  if (log.action === "프랩 소진" || log.action === "프랩 폐기") {
    return `-${log.quantity ?? 0}`;
  }

  if (log.action === "이동") {
    return `${log.source_location ?? "-"} → ${log.destination_location ?? "-"} ${log.quantity ?? 0}`;
  }

  if (log.action === "조정") {
    const note = log.note ? ` (${log.note})` : "";
    return `${log.previous_quantity ?? 0} → ${log.new_quantity ?? 0}${note}`;
  }

  if (log.action === "입고" && log.quantity === null && log.note) {
    return log.note;
  }

  if (log.action === "메모") {
    return log.note ?? "메모";
  }

  const sign = log.action === "입고" ? "+" : "-";
  const location = log.destination_location ?? log.source_location ?? "-";
  if (location === "-") {
    return `${sign}${log.quantity ?? 0}`;
  }
  return `${location} ${sign}${log.quantity ?? 0}`;
}
