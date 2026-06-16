import { useState } from "react";
import { CheckCircle2, Link as LinkIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import type { StaffProfile } from "../types/domain";

type Props = {
  token: string;
  signedIn: boolean;
  onLogin: () => void;
  onAccepted: (profile: StaffProfile) => void;
};

export function InviteAcceptPage({ token, signedIn, onLogin, onAccepted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function acceptInvite() {
    setLoading(true);
    setError("");

    const { data, error: acceptError } = await supabase.rpc("accept_store_invite" as never, { invite_token: token } as never);
    if (acceptError) {
      setError(acceptError.message);
    } else if (data) {
      onAccepted(data as StaffProfile);
    }

    setLoading(false);
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-xl">
        <PageTitle title="초대 수락" description="초대받은 이메일 계정으로 로그인한 뒤 매장에 연결합니다." />
        <div className="panel space-y-4 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-brand-600 text-white">
              <LinkIcon size={21} />
            </div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">초대 링크가 확인되었습니다.</p>
          </div>
          {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
          {signedIn ? (
            <button type="button" onClick={acceptInvite} className="primary-button inline-flex w-full items-center justify-center gap-2" disabled={loading}>
              <CheckCircle2 size={19} />
              {loading ? "수락 중..." : "초대 수락"}
            </button>
          ) : (
            <button type="button" onClick={onLogin} className="primary-button w-full">
              로그인하고 초대 수락
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
