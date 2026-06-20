import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { StatusMessage } from "../components/StatusMessage";
import type { StaffProfile } from "../types/domain";

type Props = {
  initialMode?: "login" | "signup";
  initialEmail?: string;
  inviteToken?: string;
  onInviteAccepted?: (profile: StaffProfile) => void;
};

export function LoginPage({ initialMode = "login", initialEmail = "", inviteToken, onInviteAccepted }: Props) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function acceptInviteAfterAuth() {
    if (!inviteToken) return false;

    setMessage("매장에 연결하는 중입니다.");
    const { data: profileData, error: acceptError } = await supabase.rpc("accept_store_invite" as never, { invite_token: inviteToken } as never);
    if (acceptError) {
      setError(acceptError.message);
      return true;
    }
    if (profileData && onInviteAccepted) {
      onInviteAccepted(profileData as StaffProfile);
      return true;
    }
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (mode === "signup" && password !== confirmPassword) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }

    setLoading(true);

    if (mode === "login") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
      } else if (!(await acceptInviteAfterAuth())) {
        setMessage("로그인되었습니다.");
      }
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin
        }
      });
      if (signUpError) {
        setError(signUpError.message);
      } else if (!data.session) {
        setError("회원가입은 완료됐지만 자동 로그인이 되지 않았습니다. Supabase Email 설정에서 Confirm email이 꺼져 있는지 확인해 주세요.");
      } else if (inviteToken && data.session) {
        await acceptInviteAfterAuth();
      } else {
        setMessage("회원가입이 완료되었습니다.");
      }
    }

    setLoading(false);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <form onSubmit={handleSubmit} className="panel w-full max-w-sm p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-brand-600 text-white">
            <LockKeyhole size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold">로그인</h1>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm font-bold dark:bg-slate-900">
          <button type="button" onClick={() => setMode("login")} className={`rounded px-3 py-2 ${mode === "login" ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-100" : "text-slate-500 dark:text-slate-400"}`}>
            로그인
          </button>
          <button type="button" onClick={() => setMode("signup")} className={`rounded px-3 py-2 ${mode === "signup" ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-100" : "text-slate-500 dark:text-slate-400"}`}>
            회원가입
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">이메일</span>
            <input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">비밀번호</span>
            <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={4} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {mode === "signup" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">비밀번호 확인</span>
              <input className="field" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={4} autoComplete="new-password" />
            </label>
          ) : null}
          {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
          {message ? <StatusMessage type="success">{message}</StatusMessage> : null}
          <button className="primary-button w-full" type="submit" disabled={loading}>
            {loading ? (mode === "login" ? "로그인 중..." : "가입 중...") : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </div>
      </form>
    </main>
  );
}
