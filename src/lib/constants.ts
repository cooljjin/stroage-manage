import { Boxes, ClipboardList, ScanLine, TriangleAlert } from "lucide-react";
import type { InventoryAction } from "../types/domain";

export const QUICK_AMOUNTS = [1, 5, 10] as const;
export const ACTIONS: InventoryAction[] = ["입고", "출고", "이동", "조정"];

export const NAV_ITEMS = [
  { route: "scan", label: "스캔", icon: ScanLine },
  { route: "inventory", label: "재고현황", icon: Boxes },
  { route: "low-stock", label: "부족재고", icon: TriangleAlert },
  { route: "logs", label: "작업로그", icon: ClipboardList }
] as const;

export const VIEW_MODE_STORAGE_KEY = "inventory-view-mode";
export const DARK_MODE_STORAGE_KEY = "inventory-dark-mode";
