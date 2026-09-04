import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import * as Services from "../services";
import type { StaffProfile } from "../types/domain";
import { StatusMessage } from "../components/StatusMessage";

type Props = {
  onRecovered: (profile: StaffProfile) => void;
  onDeleted: () => Promise<void> | void;
};

export function AccountDeletionRecoveryPage({ onRecovered, onDeleted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function restore() {
    setLoading(true);
    setError("");
    const { data, error: restoreError } = await Services.EdgeFunctionService.invoke<{ error?: string; profile?: StaffProfile }>("manage-account-deletion", { body: { action: "restore" } });
    if (restoreError || data?.error || !data?.profile) {
      setError(data?.error ?? restoreError?.message ?? "매장 복구에 실패했습니다.");
    } else {
      onRecovered(data.profile);
    }
    setLoading(false);
  }

  async function deleteNow() {
    if (!window.confirm("매장 데이터와 계정을 지금 바로 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    setLoading(true);
    setError("");
    const { data, error: deleteError } = await Services.EdgeFunctionService.invoke<{ error?: string; authUserDeleted?: boolean; storeDeleted?: boolean }>("manage-account-deletion", { body: { action: "delete_now" } });
    if (deleteError || data?.error || !data?.authUserDeleted || !data?.storeDeleted) {
      setError(data?.error ?? deleteError?.message ?? "계정을 바로 삭제하지 못했습니다.");
      setLoading(false);
      return;
    }
    await onDeleted();
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="panel w-full max-w-lg p-6">
        <h1 className="text-2xl font-black">탈퇴 요청이 진행 중입니다</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">매장과 계정은 탈퇴 요청일로부터 30일 동안 보관됩니다. 기간 안에 복구하면 이전 데이터로 다시 이용할 수 있습니다.</p>
        {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}
        <button type="button" onClick={() => void restore()} disabled={loading} className="primary-button mt-6 inline-flex w-full items-center justify-center gap-2 disabled:opacity-60">
          <RotateCcw size={18} />
          {loading ? "처리 중..." : "매장과 계정 복구"}
        </button>
        <button type="button" onClick={() => void deleteNow()} disabled={loading} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950">
          <Trash2 size={18} />
          {loading ? "처리 중..." : "바로 계정 삭제"}
        </button>
        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">바로 삭제하면 매장 데이터와 계정이 영구 삭제되며 복구할 수 없습니다.</p>
      </section>
    </main>
  );
}
