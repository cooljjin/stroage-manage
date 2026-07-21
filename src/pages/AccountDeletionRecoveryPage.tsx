import { useState } from "react";
import { RotateCcw } from "lucide-react";
import * as Services from "../services";
import type { StaffProfile } from "../types/domain";
import { StatusMessage } from "../components/StatusMessage";

export function AccountDeletionRecoveryPage({ onRecovered }: { onRecovered: (profile: StaffProfile) => void }) {
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

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="panel w-full max-w-lg p-6">
        <h1 className="text-2xl font-black">탈퇴 요청이 진행 중입니다</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">개인 매장과 계정은 탈퇴 요청일로부터 30일 동안 보관됩니다. 기간 안에 복구하면 이전 데이터로 다시 이용할 수 있습니다.</p>
        {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}
        <button type="button" onClick={() => void restore()} disabled={loading} className="primary-button mt-6 inline-flex w-full items-center justify-center gap-2 disabled:opacity-60">
          <RotateCcw size={18} />
          {loading ? "복구 중..." : "매장과 계정 복구"}
        </button>
      </section>
    </main>
  );
}
