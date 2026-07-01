export const DEFAULT_CATEGORIES = ["원두", "우유", "시럽", "베이커리", "아이스크림", "소모품", "음료", "기타"] as const;
export const DEFAULT_PRODUCT_UNITS = ["박스", "낱개", "줄", "팩"] as const;

export type Category = string;
export type CategoryFilter = "전체" | string;
export type Location = "창고" | "매장";
export type InventoryAction = "입고" | "출고" | "이동" | "조정" | "메모" | "프랩 제조" | "프랩 소진" | "프랩 폐기";
export type ViewMode = "compact" | "full";
export type StorageType = "냉장" | "냉동" | "상온";
export type StockStatus = "충분" | "절반 이하" | "발주 필요";
export type UnitWeightUnit = "g" | "kg" | "ml" | "L";
export type ProfileRole = "master" | "store_admin" | "staff";
export type RouteName =
  | "landing"
  | "login"
  | "signup-request"
  | "invite-accept"
  | "home"
  | "scan"
  | "register"
  | "product-edit"
  | "operation"
  | "inventory"
  | "low-stock"
  | "status-items"
  | "logs"
  | "prep-items"
  | "prep-mode"
  | "category-management"
  | "unit-management"
  | "supplier-management"
  | "settings"
  | "staff-management"
  | "master-stores"
  | "master-store-detail"
  | "master-users"
  | "admin";

export type Product = {
  id: string;
  store_id: string;
  barcode: string | null;
  name: string;
  category: Category;
  supplier_name: string | null;
  storage_type: string | null;
  unit_name: string | null;
  unit_weight_enabled: boolean;
  unit_weight: number | null;
  unit_weight_unit: UnitWeightUnit | null;
  processing_required: boolean;
  processed_unit_weight: number | null;
  processed_unit_weight_unit: UnitWeightUnit | null;
  product_url: string | null;
  order_completed: boolean;
  urgent_order_requested: boolean;
  urgent_order_quantity: number | null;
  fresh_order_selected: boolean;
  fresh_order_selected_at: string | null;
  receipt_check_only: boolean;
  status_enabled: boolean;
  stock_status: StockStatus | null;
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
  order_method: "link" | "sms";
  sms_phone: string | null;
  sms_template: string | null;
  is_active: boolean;
  created_at: string;
};

export type ProductUnit = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type ProductBarcode = {
  id: string;
  store_id: string;
  product_id: string;
  barcode: string;
  created_at: string;
};

export type StaffProfile = {
  id: string;
  store_id: string;
  email: string | null;
  display_name: string;
  is_admin: boolean;
  role: ProfileRole;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Store = {
  id: string;
  name: string;
  business_name: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

export type StoreInvite = {
  id: string;
  store_id: string;
  email: string;
  role: Exclude<ProfileRole, "master">;
  token: string;
  invited_by: string;
  accepted_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
};

export type Inventory = {
  id: string;
  store_id: string;
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

export type PrepItem = {
  id: string;
  store_id: string;
  product_id: string;
  name: string;
  shelf_life_days: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PrepItemIngredient = {
  id: string;
  store_id: string;
  prep_item_id: string;
  ingredient_product_id: string | null;
  ingredient_name: string | null;
  ingredient_unit: "g" | "kg" | "ml" | "L" | "개" | null;
  quantity_per_unit: number;
  sort_order: number;
  created_at: string;
};

export type PrepItemRouteDraft = {
  editingId: string | null;
  name: string;
  shelfLifeDays: string;
  sortOrder: string;
  ingredientDrafts: {
    productId: string;
    customName: string;
    quantity: string;
    quantityUnit: "g" | "kg" | "ml" | "L" | "개";
    search: string;
  }[];
};

export type PrepBatch = {
  id: string;
  store_id: string;
  prep_item_id: string;
  quantity_produced: number;
  quantity_remaining: number;
  manufactured_at: string;
  expires_on: string;
  created_by: string;
  created_at: string;
};

export type InventoryLog = {
  id: string;
  store_id: string;
  product_id: string;
  user_id: string;
  action: InventoryAction;
  source_location: Location | null;
  destination_location: Location | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  quantity: number | null;
  note: string | null;
  warehouse_qty_before: number | null;
  store_qty_before: number | null;
  warehouse_qty_after: number | null;
  store_qty_after: number | null;
  reverted_at: string | null;
  reverted_by: string | null;
  restored_to_log_id: string | null;
  created_at: string;
  products: Pick<Product, "name" | "barcode" | "receipt_check_only"> | null;
};

export type InventoryLogWithStaff = InventoryLog & {
  staff_name: string;
};

export type DashboardTodo = {
  id: string;
  task_date: string;
  content: string;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string;
  created_at: string;
};

export type HandoverNote = {
  id: string;
  store_id: string;
  handover_date: string;
  content: string;
  created_by: string;
  created_at: string;
  author_name?: string;
};

export type WeeklyStoreClosure = {
  weekday: number;
  created_by: string;
  created_at: string;
};

export type StoreClosureDate = {
  closure_date: string;
  reason: string | null;
  created_by: string;
  created_at: string;
};

export type AppRoute = {
  name: RouteName;
  authMode?: "login" | "signup";
  authEmail?: string;
  authInviteToken?: string;
  barcode?: string;
  productId?: string;
  prepItemId?: string;
  returnTo?: "prep-items";
  prepDraft?: PrepItemRouteDraft;
  storeId?: string;
  inviteToken?: string;
};

export type SortKey = "name" | "warehouse_qty" | "store_qty" | "total_stock";
export type SortDirection = "asc" | "desc";
