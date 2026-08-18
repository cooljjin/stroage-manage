import * as Services from "../services";
import { createMutationRequestId, formatMutationError, isUncertainMutationError } from "./mutationRequest";

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
  note: string,
  requestId = createMutationRequestId()
): Promise<{ errorMessage: string; logId: string | null; uncertain: boolean }> {
  const { data: logId, error } = await Services.DatabaseService.rpc("record_receipt_check_idempotent", {
    target_product_id: productId,
    receipt_quantity: quantity,
    receipt_note: note,
    request_id: requestId
  });

  return {
    errorMessage: error ? (isUncertainMutationError(error) ? formatMutationError(error) : formatReceiptCheckError(error.message)) : "",
    logId: error ? null : logId ?? null,
    uncertain: isUncertainMutationError(error)
  };
}

export async function recordReceiptCheckOnly(productId: string, storeId: string, quantity?: number | null, requestId?: string): Promise<{ errorMessage: string; logId: string | null; uncertain: boolean }> {
  return recordReceiptWithoutStockChange(productId, storeId, quantity ?? null, RECEIPT_CHECK_NOTE, requestId);
}

export async function recordReceiptCompletion(productId: string, storeId: string, requestId?: string): Promise<{ errorMessage: string; logId: string | null; uncertain: boolean }> {
  return recordReceiptWithoutStockChange(productId, storeId, null, "입고완료 확인", requestId);
}
