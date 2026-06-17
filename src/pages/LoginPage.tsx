import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { StatusMessage } from "../components/StatusMessage";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
      if (signInError) setError(signInError.message);
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else if (!data.session) {
        setMessage("가입 확인 메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.");
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
            <h1 className="text-xl font-bold">매장 재고관리</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{mode === "login" ? "작업자 추적을 위해 로그인합니다." : "초대받은 이메일로 계정을 만듭니다."}</p>
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
            <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {mode === "signup" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">비밀번호 확인</span>
              <input className="field" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
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
