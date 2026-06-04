export const CATEGORIES = ["원두", "우유", "시럽", "베이커리", "아이스크림", "소모품", "음료", "기타"] as const;
export const CATEGORY_FILTERS = ["전체", ...CATEGORIES] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryFilter = (typeof CATEGORY_FILTERS)[number];
export type Location = "창고" | "매장";
export type InventoryAction = "입고" | "출고" | "이동" | "조정";
export type ViewMode = "compact" | "full";
export type RouteName = "scan" | "register" | "operation" | "inventory" | "low-stock" | "logs";

export type Product = {
  id: string;
  barcode: string | null;
  name: string;
  category: Category;
  minimum_stock: number;
  created_at: string;
};

export type Inventory = {
  id: string;
  product_id: string;
  warehouse_qty: number;
  store_qty: number;
  updated_at: string;
};

export type InventoryItem = Product & {
  inventory: Inventory | null;
  warehouse_qty: number;
  store_qty: number;
  total_stock: number;
  is_low_stock: boolean;
};

export type InventoryLog = {
  id: string;
  product_id: string;
  user_id: string;
  action: InventoryAction;
  source_location: Location | null;
  destination_location: Location | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  quantity: number | null;
  note: string | null;
  created_at: string;
  products: Pick<Product, "name" | "barcode"> | null;
};

export type AppRoute = {
  name: RouteName;
  barcode?: string;
  productId?: string;
};

export type SortKey = "name" | "warehouse_qty" | "store_qty" | "total_stock";
export type SortDirection = "asc" | "desc";
