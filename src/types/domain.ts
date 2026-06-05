export const DEFAULT_CATEGORIES = ["원두", "우유", "시럽", "베이커리", "아이스크림", "소모품", "음료", "기타"] as const;

export type Category = string;
export type CategoryFilter = "전체" | string;
export type Location = "창고" | "매장";
export type InventoryAction = "입고" | "출고" | "이동" | "조정";
export type ViewMode = "compact" | "full";
export type StorageType = "냉장" | "냉동" | "상온";
export type RouteName = "scan" | "register" | "operation" | "inventory" | "low-stock" | "logs" | "product-management" | "category-management" | "supplier-management" | "admin";

export type Product = {
  id: string;
  barcode: string | null;
  name: string;
  category: Category;
  supplier_name: string | null;
  storage_type: StorageType | null;
  minimum_stock: number;
  is_active: boolean;
  created_at: string;
};

export type ProductCategory = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type ProductSupplier = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type StaffProfile = {
  id: string;
  email: string | null;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
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

export type InventoryLogWithStaff = InventoryLog & {
  staff_name: string;
};

export type AppRoute = {
  name: RouteName;
  barcode?: string;
  productId?: string;
};

export type SortKey = "name" | "warehouse_qty" | "store_qty" | "total_stock";
export type SortDirection = "asc" | "desc";
