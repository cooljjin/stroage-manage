import type { RouteName, StaffPermissionKey } from "../types/domain";

export const STAFF_PERMISSION_OPTIONS: ReadonlyArray<{ key: StaffPermissionKey; label: string; route: RouteName }> = [
  { key: "category_management", label: "카테고리 관리", route: "category-management" },
  { key: "supplier_management", label: "발주처 관리", route: "supplier-management" },
  { key: "group_order_recipe_management", label: "메뉴 레시피 등록", route: "group-order-recipes" },
  { key: "order_confirmation", label: "발주 품목 확정", route: "low-stock" }
];

const permissionByRoute = new Map(STAFF_PERMISSION_OPTIONS.map((permission) => [permission.route, permission.key]));

export function permissionForRoute(route: RouteName): StaffPermissionKey | null {
  return permissionByRoute.get(route) ?? null;
}

export function hasStaffPermission(permissions: readonly StaffPermissionKey[], permission: StaffPermissionKey) {
  return permissions.includes(permission);
}
