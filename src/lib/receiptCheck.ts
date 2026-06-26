import { supabase } from "./supabase";

export const RECEIPT_CHECK_NOTE = "입고여부만 확인";

export function formatReceiptCheckError(message: string) {
  if (message.includes("receipt_check_only") || message.includes("schema cache")) {
    return "입고여부만 확인 기능용 데이터베이스 업데이트가 필요합니다.";
  }
  return message;
}

export async function recordReceiptCheckOnly(productId: string): Promise<{ errorMessage: string }> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { errorMessage: userError?.message ?? "로그인이 필요합니다." };
  }

  const { data: inventory, error: inventoryError } = await supabase
    .from("inventory")
    .upsert({ product_id: productId }, { onConflict: "product_id" })
    .select()
    .single();

  if (inventoryError) {
    return { errorMessage: inventoryError.message };
  }

  const warehouseQty = Number(inventory?.warehouse_qty ?? 0);
  const storeQty = Number(inventory?.store_qty ?? 0);
  const { error: logError } = await supabase.from("inventory_logs").insert({
    product_id: productId,
    user_id: userData.user.id,
    action: "입고",
    source_location: null,
    destination_location: null,
    previous_quantity: null,
    new_quantity: null,
    quantity: null,
    note: RECEIPT_CHECK_NOTE,
    warehouse_qty_before: warehouseQty,
    store_qty_before: storeQty,
    warehouse_qty_after: warehouseQty,
    store_qty_after: storeQty
  });

  return { errorMessage: logError ? formatReceiptCheckError(logError.message) : "" };
}
