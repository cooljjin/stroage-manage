import * as Services from "../services";

export const RECEIPT_CHECK_NOTE = "입고여부만 확인";

export function formatReceiptCheckError(message: string) {
  if (message.includes("receipt_check_only") || message.includes("schema cache")) {
    return "입고여부만 확인 기능용 데이터베이스 업데이트가 필요합니다.";
  }
  return message;
}

async function recordReceiptWithoutStockChange(
  productId: string,
  _storeId: string,
  quantity: number | null,
  note: string
): Promise<{ errorMessage: string; logId: string | null }> {
  const { data: logId, error } = await Services.DatabaseService.rpc("record_receipt_check", {
    target_product_id: productId,
    receipt_quantity: quantity,
    receipt_note: note
  });

  return {
    errorMessage: error ? formatReceiptCheckError(error.message) : "",
    logId: error ? null : logId ?? null
  };
}

export async function recordReceiptCheckOnly(productId: string, storeId: string, quantity?: number | null): Promise<{ errorMessage: string; logId: string | null }> {
  return recordReceiptWithoutStockChange(productId, storeId, quantity ?? null, RECEIPT_CHECK_NOTE);
}

export async function recordReceiptCompletion(productId: string, storeId: string): Promise<{ errorMessage: string; logId: string | null }> {
  return recordReceiptWithoutStockChange(productId, storeId, null, "입고완료 확인");
}
