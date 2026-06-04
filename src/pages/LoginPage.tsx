import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { StatusMessage } from "../components/StatusMessage";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);

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
            <p className="text-sm text-slate-500 dark:text-slate-400">작업자 추적을 위해 로그인합니다.</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">이메일</span>
            <input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">비밀번호</span>
            <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
          </label>
          {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
          <button className="primary-button w-full" type="submit" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </div>
      </form>
    </main>
  );
}
