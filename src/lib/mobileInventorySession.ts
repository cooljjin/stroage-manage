import * as Services from "../services";
import type { Location, MobileInventoryMode } from "../types/domain";
import type { MobileMoveDirection } from "./mobileInventory";

export type MobileInventoryApplyInput = {
  targetSessionId: string | null;
  targetProductId: string;
  operationMode: MobileInventoryMode;
  targetLocation: Location | null;
  moveDirection: MobileMoveDirection | null;
  requestedWarehouseQty: number;
  requestedStoreQty: number;
  expectedWarehouseVersion: number;
  expectedStoreVersion: number;
  requestId: string;
  entrySource: "operation" | "scan_audit";
};

export type MobileInventoryApplyResult = {
  session_id: string;
  warehouse_qty: number;
  store_qty: number;
  warehouse_version: number;
  store_version: number;
  inventory_updated_at: string;
  last_activity_at: string;
};

function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function applyMobileInventoryChange(input: MobileInventoryApplyInput) {
  const { data, error } = await Services.DatabaseService.rpc("apply_mobile_inventory_change_v2", {
    target_session_id: input.targetSessionId,
    target_product_id: input.targetProductId,
    operation_mode: input.operationMode,
    target_location: input.targetLocation,
    move_direction: input.moveDirection,
    requested_warehouse_qty: input.requestedWarehouseQty,
    requested_store_qty: input.requestedStoreQty,
    expected_warehouse_version: input.expectedWarehouseVersion,
    expected_store_version: input.expectedStoreVersion,
    request_id: input.requestId,
    entry_source: input.entrySource
  });

  return { data: firstRow(data as MobileInventoryApplyResult | MobileInventoryApplyResult[] | null), error };
}

export async function finalizeMobileInventorySession(sessionId: string | null) {
  if (!sessionId) return { data: null, error: null };
  return Services.DatabaseService.rpc("finalize_mobile_inventory_session", {
    target_session_id: sessionId,
    finalization_reason: "navigation"
  });
}

export async function recoverMobileInventorySessions(activeSessionId: string | null = null) {
  return Services.DatabaseService.rpc("recover_mobile_inventory_sessions", {
    active_session_id: activeSessionId
  });
}
