import * as Services from "../services";

export const RECEIPT_CHECK_NOTE = "입고여부만 확인";

export function formatReceiptCheckError(message: string) {
  if (message.includes("receipt_check_only") || message.includes("schema cache")) {
    return "입고여부만 확인 기능용 데이터베이스 업데이트가 필요합니다.";
  }
  return message;
}

export async function recordReceiptCheckOnly(productId: string, storeId: string, quantity?: number | null): Promise<{ errorMessage: string }> {
  const { data: userData, error: userError } = await Services.AuthService.getUser();
  if (userError || !userData.user) {
    return { errorMessage: userError?.message ?? "로그인이 필요합니다." };
  }

  const { data: inventory, error: inventoryError } = await Services.DatabaseService.upsert("inventory", { product_id: productId, store_id: storeId }, { onConflict: "product_id" })
    .select()
    .single();

  if (inventoryError) {
    return { errorMessage: inventoryError.message };
  }

  const warehouseQty = Number(inventory?.warehouse_qty ?? 0);
  const storeQty = Number(inventory?.store_qty ?? 0);
  const { error: logError } = await Services.DatabaseService.insert("inventory_logs", {
    store_id: storeId,
    product_id: productId,
    user_id: userData.user.id,
    action: "입고",
    source_location: null,
    destination_location: null,
    previous_quantity: null,
    new_quantity: null,
    quantity: quantity ?? null,
    note: RECEIPT_CHECK_NOTE,
    warehouse_qty_before: warehouseQty,
    store_qty_before: storeQty,
    warehouse_qty_after: warehouseQty,
    store_qty_after: storeQty
  });

  if (logError) {
    return { errorMessage: formatReceiptCheckError(logError.message) };
  }

  const { error: freshOrderError } = await Services.DatabaseService.update("products", {
      fresh_order_selected: false,
      fresh_order_selected_at: null,
      urgent_order_requested: false,
      urgent_order_quantity: null
    })
    .eq("store_id", storeId)
    .eq("id", productId);

  return { errorMessage: freshOrderError ? formatReceiptCheckError(freshOrderError.message) : "" };
}
