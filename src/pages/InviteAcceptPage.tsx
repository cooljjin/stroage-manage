import { FormEvent, useState } from "react";
import { CheckCircle2, Link as LinkIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import type { StaffProfile } from "../types/domain";

type Props = {
  token: string;
  signedIn: boolean;
  onAccepted: (profile: StaffProfile) => void;
};

export function InviteAcceptPage({ token, signedIn, onAccepted }: Props) {
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (authMode === "signup" && password !== confirmPassword) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }

    setAuthLoading(true);

    if (authMode === "login") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) setError(signInError.message);
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else if (!data.session) {
        setMessage("가입 확인 메일을 보냈습니다. 이메일 인증 후 이 초대 링크로 다시 접속해 주세요.");
      } else {
        setMessage("회원가입이 완료되었습니다. 이제 초대를 수락할 수 있습니다.");
      }
    }

    setAuthLoading(false);
  }

  async function acceptInvite() {
    setLoading(true);
    setError("");
    setMessage("");

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
        <PageTitle title="초대 수락" description="초대받은 이메일 계정으로 가입하거나 로그인한 뒤 매장에 연결합니다." />
        <div className="panel space-y-4 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-brand-600 text-white">
              <LinkIcon size={21} />
            </div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">초대 링크가 확인되었습니다.</p>
          </div>
          {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
          {message ? <StatusMessage type="success">{message}</StatusMessage> : null}
          {signedIn ? (
            <button type="button" onClick={acceptInvite} className="primary-button inline-flex w-full items-center justify-center gap-2" disabled={loading}>
              <CheckCircle2 size={19} />
              {loading ? "수락 중..." : "초대 수락"}
            </button>
          ) : (
            <form onSubmit={handleAuth} className="space-y-3">
              <div className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm font-bold dark:bg-slate-900">
                <button type="button" onClick={() => setAuthMode("signup")} className={`rounded px-3 py-2 ${authMode === "signup" ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-100" : "text-slate-500 dark:text-slate-400"}`}>
                  회원가입
                </button>
                <button type="button" onClick={() => setAuthMode("login")} className={`rounded px-3 py-2 ${authMode === "login" ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-100" : "text-slate-500 dark:text-slate-400"}`}>
                  로그인
                </button>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">초대받은 이메일</span>
                <input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">비밀번호</span>
                <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={authMode === "login" ? "current-password" : "new-password"} />
              </label>
              {authMode === "signup" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">비밀번호 확인</span>
                  <input className="field" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
                </label>
              ) : null}
              <button className="primary-button w-full" type="submit" disabled={authLoading}>
                {authLoading ? (authMode === "login" ? "로그인 중..." : "가입 중...") : authMode === "login" ? "로그인" : "회원가입"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
