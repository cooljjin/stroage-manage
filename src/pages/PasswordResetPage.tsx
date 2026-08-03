import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import * as Services from "../services";
import { StatusMessage } from "../components/StatusMessage";

type Props = {
  onCompleted: () => void;
};

export function PasswordResetPage({ onCompleted }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("비밀번호는 6자 이상으로 입력해 주세요.");
      return;
    }
    if (password !== confirmPassword) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await Services.AuthService.updatePassword(password);
    if (updateError) {
      setError("비밀번호를 변경하지 못했습니다. 재설정 메일의 링크를 다시 열어 주세요.");
      setSaving(false);
      return;
    }

    onCompleted();
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f8ff] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-[1.75rem] border border-white/80 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] dark:border-slate-800 dark:bg-slate-950 sm:p-8">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-600 text-white">
          <KeyRound size={24} />
        </div>
        <h1 className="mt-5 text-3xl font-black">새 비밀번호 설정</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">새 비밀번호를 설정한 뒤 다시 로그인해 주세요.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">새 비밀번호</span>
            <input className="field border-slate-200 bg-slate-50 dark:bg-slate-900" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} autoComplete="new-password" required />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">새 비밀번호 확인</span>
            <input className="field border-slate-200 bg-slate-50 dark:bg-slate-900" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} autoComplete="new-password" required />
          </label>
          {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
          <button type="submit" disabled={saving} className="primary-button w-full disabled:opacity-60">
            {saving ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </section>
    </main>
  );
}
