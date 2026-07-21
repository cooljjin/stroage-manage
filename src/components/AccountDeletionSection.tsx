import { useState } from "react";
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";
import * as Services from "../services";
import type { StaffProfile } from "../types/domain";
import { StatusMessage } from "./StatusMessage";

type Member = Pick<StaffProfile, "id" | "display_name" | "email" | "role">;
type Eligibility = {
  kind: "personal" | "shared";
  members: Member[];
  purgeAfter: string | null;
};

type Props = {
  onLogout: () => Promise<void> | void;
};

export function AccountDeletionSection({ onLogout }: Props) {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [transferToUserId, setTransferToUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openDeletion() {
    setLoading(true);
    setError("");
    const { data, error: requestError } = await Services.EdgeFunctionService.invoke<Eligibility & { error?: string }>("manage-account-deletion", {
      body: { action: "eligibility" }
    });
    if (requestError || data?.error || !data) {
      setError(data?.error ?? requestError?.message ?? "탈퇴 가능 여부를 확인하지 못했습니다.");
    } else {
      setEligibility(data);
      setTransferToUserId(data.members[0]?.id ?? "");
    }
    setLoading(false);
  }

  async function requestDeletion() {
    if (!eligibility) return;
    const warning = eligibility.kind === "personal"
      ? "탈퇴를 요청하면 매장과 계정이 30일 동안 비활성화됩니다. 이 기간 안에 로그인하여 복구할 수 있습니다. 계속할까요?"
      : "선택한 구성원을 관리자로 이관하고 내 계정을 완전히 삭제할까요? 이 작업은 되돌릴 수 없습니다.";
    if (!window.confirm(warning)) return;

    setLoading(true);
    setError("");
    const { data, error: requestError } = await Services.EdgeFunctionService.invoke<{ error?: string }>("manage-account-deletion", {
      body: {
        action: "request",
        ...(eligibility.kind === "shared" ? { transferToUserId } : {})
      }
    });
    if (requestError || data?.error) {
      setError(data?.error ?? requestError?.message ?? "탈퇴 요청에 실패했습니다.");
      setLoading(false);
      return;
    }
    await onLogout();
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-red-100 px-4 py-4 dark:border-red-950">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"><AlertTriangle size={21} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-extrabold">계정 탈퇴</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">개인 매장은 30일 내 복구할 수 있으며, 공동 매장은 관리자 이관 후 탈퇴합니다.</p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
        {!eligibility ? (
          <button type="button" onClick={() => void openDeletion()} disabled={loading} className="touch-button inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950">
            <Trash2 size={17} />
            {loading ? "확인 중..." : "계정 탈퇴하기"}
          </button>
        ) : eligibility.kind === "personal" ? (
          <>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">탈퇴 요청 후 매장과 계정은 30일 동안 비활성화됩니다. 기간 안에 같은 계정으로 로그인하면 복구할 수 있고, 기간이 지나면 매장 데이터와 계정이 영구 삭제됩니다.</p>
            <button type="button" onClick={() => void requestDeletion()} disabled={loading} className="touch-button inline-flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
              <Trash2 size={17} />
              {loading ? "처리 중..." : "30일 복구 기간으로 탈퇴 요청"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">공동 매장이므로 다른 구성원에게 관리자 권한을 이관한 뒤 계정을 완전히 삭제합니다.</p>
            {eligibility.members.length > 0 ? (
              <label className="block">
                <span className="mb-1 block text-sm font-bold">새 관리자</span>
                <select className="field" value={transferToUserId} onChange={(event) => setTransferToUserId(event.target.value)} disabled={loading}>
                  {eligibility.members.map((member) => <option key={member.id} value={member.id}>{member.display_name} ({member.email ?? "이메일 없음"})</option>)}
                </select>
              </label>
            ) : <StatusMessage type="error">이관할 구성원이 없습니다. 먼저 직원을 초대하거나 다른 관리자를 추가해 주세요.</StatusMessage>}
            <button type="button" onClick={() => void requestDeletion()} disabled={loading || !transferToUserId} className="touch-button inline-flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
              <Trash2 size={17} />
              {loading ? "처리 중..." : "관리자 이관 후 탈퇴"}
            </button>
          </>
        )}
        {eligibility ? <button type="button" onClick={() => setEligibility(null)} disabled={loading} className="touch-button inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-bold dark:border-slate-800"><RotateCcw size={17} />취소</button> : null}
      </div>
    </div>
  );
}
