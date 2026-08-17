import type { ServiceError } from "../services";

export type MutationRequestRef = { current: string | null };
export type MutationRequestMapRef = { current: Map<string, string> };

export function createMutationRequestId(): string {
  return crypto.randomUUID();
}

export function getMutationRequestId(requestRef: MutationRequestRef): string {
  requestRef.current ??= createMutationRequestId();
  return requestRef.current;
}

export function getMappedMutationRequestId(requestRef: MutationRequestMapRef, key: string): string {
  const current = requestRef.current.get(key);
  if (current) return current;
  const next = createMutationRequestId();
  requestRef.current.set(key, next);
  return next;
}

export function isUncertainMutationError(error: Pick<ServiceError, "message"> | null | undefined): boolean {
  if (!error) return false;
  return /failed to fetch|fetch failed|network|timeout|timed out|aborterror|aborted|gateway timeout|service unavailable/i.test(error.message);
}

export function finishMutationRequest(requestRef: MutationRequestRef, error: Pick<ServiceError, "message"> | null | undefined) {
  if (!isUncertainMutationError(error)) requestRef.current = null;
}

export function finishMappedMutationRequest(requestRef: MutationRequestMapRef, key: string, error: Pick<ServiceError, "message"> | null | undefined) {
  if (!isUncertainMutationError(error)) requestRef.current.delete(key);
}

export function formatMutationError(error: Pick<ServiceError, "message">): string {
  return isUncertainMutationError(error)
    ? "저장 결과를 확인하지 못했습니다. 저장 버튼을 다시 눌러 같은 요청을 확인해 주세요."
    : error.message;
}
