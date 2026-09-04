import { lazy } from "react";
import type { RouteName } from "../types/domain";

const loadHomePage = () => import("../pages/HomePage");
const loadTimelineCalendarPage = () => import("../pages/TimelineCalendarPage");
const loadScanPage = () => import("../pages/ScanPage");
const loadProductEditPage = () => import("../pages/ProductEditPage");
const loadInventoryOperationPage = () => import("../pages/InventoryOperationPage");
const loadInventoryListPage = () => import("../pages/InventoryListPage");
const loadLowStockPage = () => import("../pages/LowStockPage");
const loadStatusItemsPage = () => import("../pages/StatusItemsPage");
const loadLogsPage = () => import("../pages/LogsPage");
const loadTodoRoutinesPage = () => import("../pages/TodoRoutinesPage");
const loadGroupOrderCalculatorPage = () => import("../pages/GroupOrderCalculatorPage");
const loadRecipeImportPage = () => import("../pages/RecipeImportPage");
const loadPrepItemManagementPage = () => import("../pages/PrepItemManagementPage");
const loadPrepModePage = () => import("../pages/PrepModePage");
const loadCategoryManagementPage = () => import("../pages/CategoryManagementPage");
const loadProductUnitManagementPage = () => import("../pages/ProductUnitManagementPage");
const loadSupplierManagementPage = () => import("../pages/SupplierManagementPage");
const loadSettingsPage = () => import("../pages/SettingsPage");
const loadStaffManagementPage = () => import("../pages/StaffManagementPage");
const loadStaffPermissionsPage = () => import("../pages/StaffPermissionsPage");

export const HomePage = lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));
export const TimelineCalendarPage = lazy(() => loadTimelineCalendarPage().then((module) => ({ default: module.TimelineCalendarPage })));
export const ScanPage = lazy(() => loadScanPage().then((module) => ({ default: module.ScanPage })));
export const ProductEditPage = lazy(() => loadProductEditPage().then((module) => ({ default: module.ProductEditPage })));
export const InventoryOperationPage = lazy(() => loadInventoryOperationPage().then((module) => ({ default: module.InventoryOperationPage })));
export const InventoryListPage = lazy(() => loadInventoryListPage().then((module) => ({ default: module.InventoryListPage })));
export const LowStockPage = lazy(() => loadLowStockPage().then((module) => ({ default: module.LowStockPage })));
export const StatusItemsPage = lazy(() => loadStatusItemsPage().then((module) => ({ default: module.StatusItemsPage })));
export const LogsPage = lazy(() => loadLogsPage().then((module) => ({ default: module.LogsPage })));
export const TodoRoutinesPage = lazy(() => loadTodoRoutinesPage().then((module) => ({ default: module.TodoRoutinesPage })));
export const GroupOrderCalculatorPage = lazy(() => loadGroupOrderCalculatorPage().then((module) => ({ default: module.GroupOrderCalculatorPage })));
export const RecipeImportPage = lazy(() => loadRecipeImportPage().then((module) => ({ default: module.RecipeImportPage })));
export const PrepItemManagementPage = lazy(() => loadPrepItemManagementPage().then((module) => ({ default: module.PrepItemManagementPage })));
export const PrepModePage = lazy(() => loadPrepModePage().then((module) => ({ default: module.PrepModePage })));
export const CategoryManagementPage = lazy(() => loadCategoryManagementPage().then((module) => ({ default: module.CategoryManagementPage })));
export const ProductUnitManagementPage = lazy(() => loadProductUnitManagementPage().then((module) => ({ default: module.ProductUnitManagementPage })));
export const SupplierManagementPage = lazy(() => loadSupplierManagementPage().then((module) => ({ default: module.SupplierManagementPage })));
export const SettingsPage = lazy(() => loadSettingsPage().then((module) => ({ default: module.SettingsPage })));
export const StaffManagementPage = lazy(() => loadStaffManagementPage().then((module) => ({ default: module.StaffManagementPage })));
export const StaffPermissionsPage = lazy(() => loadStaffPermissionsPage().then((module) => ({ default: module.StaffPermissionsPage })));

type RoutePageLoader = () => Promise<unknown>;

const routePageLoaders: Partial<Record<RouteName, RoutePageLoader>> = {
  home: loadHomePage,
  "timeline-calendar": loadTimelineCalendarPage,
  scan: loadScanPage,
  register: loadProductEditPage,
  "product-edit": loadProductEditPage,
  operation: loadInventoryOperationPage,
  inventory: loadInventoryListPage,
  "low-stock": loadLowStockPage,
  "status-items": loadStatusItemsPage,
  logs: loadLogsPage,
  "todo-routines": loadTodoRoutinesPage,
  "group-order": loadGroupOrderCalculatorPage,
  "group-order-recipes": loadGroupOrderCalculatorPage,
  "group-order-recipe-import": loadRecipeImportPage,
  "prep-items": loadPrepItemManagementPage,
  "prep-mode": loadPrepModePage,
  "category-management": loadCategoryManagementPage,
  "unit-management": loadProductUnitManagementPage,
  "supplier-management": loadSupplierManagementPage,
  settings: loadSettingsPage,
  "staff-management": loadStaffManagementPage,
  "staff-permissions": loadStaffPermissionsPage
};

const idlePreloadRoutes: Partial<Record<RouteName, readonly RouteName[]>> = {
  home: ["inventory", "low-stock", "scan", "logs"],
  inventory: ["operation", "product-edit"],
  scan: ["operation", "register"],
  "low-stock": ["operation"]
};

export function preloadRoutePage(routeName: RouteName) {
  return routePageLoaders[routeName]?.();
}

export function getIdlePreloadRoutes(routeName: RouteName) {
  return idlePreloadRoutes[routeName] ?? [];
}
