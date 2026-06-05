import type { Inventory, InventoryItem, Product } from "../types/domain";

type ProductWithInventory = Product & {
  inventory: Inventory[] | Inventory | null;
};

export function normalizeInventoryItem(row: ProductWithInventory): InventoryItem {
  const inventory = Array.isArray(row.inventory) ? row.inventory[0] ?? null : row.inventory;
  const warehouse_qty = inventory?.warehouse_qty ?? 0;
  const store_qty = inventory?.store_qty ?? 0;
  const total_stock = warehouse_qty + store_qty;

  return {
    ...row,
    order_completed: row.order_completed ?? false,
    inventory,
    warehouse_qty,
    store_qty,
    total_stock,
    is_low_stock: total_stock <= row.minimum_stock
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
  if (log.action === "이동") {
    return `${log.source_location ?? "-"} → ${log.destination_location ?? "-"} ${log.quantity ?? 0}`;
  }

  if (log.action === "조정") {
    const note = log.note ? ` (${log.note})` : "";
    return `${log.previous_quantity ?? 0} → ${log.new_quantity ?? 0}${note}`;
  }

  const sign = log.action === "입고" ? "+" : "-";
  const location = log.destination_location ?? log.source_location ?? "-";
  return `${location} ${sign}${log.quantity ?? 0}`;
}
