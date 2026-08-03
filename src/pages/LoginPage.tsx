import { FormEvent, useState } from "react";
import { ArrowRight, Mail, MessageCircle, Search } from "lucide-react";
import * as Services from "../services";
import { StatusMessage } from "../components/StatusMessage";

type OAuthProvider = "google" | "kakao" | "apple";

const OAUTH_BUTTONS: Array<{
  provider: OAuthProvider;
  label: string;
  className: string;
  icon: typeof Search | null;
}> = [
  {
    provider: "google",
    label: "Google로 계속하기",
    className: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900",
    icon: Search
  },
  {
    provider: "kakao",
    label: "카카오로 계속하기",
    className: "border-[#FEE500] bg-[#FEE500] text-[#191919] hover:bg-[#f5dc00]",
    icon: MessageCircle
  },
  {
    provider: "apple",
    label: "Apple로 계속하기",
    className: "border-black bg-black text-white hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200",
    icon: null
  }
];

type Props = {
  initialMode?: "login" | "signup";
  initialEmail?: string;
  onOpenPrivacy: () => void;
  onOpenSupport: () => void;
};

export function LoginPage({ initialMode = "login", initialEmail = "", onOpenPrivacy, onOpenSupport }: Props) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function requestPasswordReset() {
    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("비밀번호를 재설정할 이메일을 입력해 주세요.");
      return;
    }

    setLoading(true);
    const { error: resetError } = await Services.AuthService.resetPasswordForEmail(email.trim());
    if (resetError) {
      setError("재설정 메일을 보내지 못했습니다. 이메일 주소를 확인한 뒤 다시 시도해 주세요.");
    } else {
      setMessage("비밀번호 재설정 링크를 이메일로 보냈습니다. 메일의 링크를 열어 새 비밀번호를 설정해 주세요.");
    }
    setLoading(false);
  }

  async function handleOAuthLogin(provider: OAuthProvider) {
    setError("");
    setMessage("");
    setOauthLoading(provider);

    const { error: oauthError } =
      provider === "google"
        ? await Services.AuthService.loginWithGoogle()
        : provider === "kakao"
          ? await Services.AuthService.loginWithKakao()
          : await Services.AuthService.loginWithApple();

    if (oauthError) {
      setError(oauthError.message);
      setOauthLoading(null);
    }
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
      const { error: signInError } = await Services.AuthService.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
      } else {
        setMessage("로그인되었습니다.");
      }
    } else {
      const { data, error: signUpError } = await Services.AuthService.signUp({
        email,
        password
      });
      if (signUpError) {
        setError(signUpError.message);
      } else if (!data.session) {
        setError("회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        setMessage("회원가입이 완료되었습니다.");
      }
    }

    setLoading(false);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f8ff] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)] dark:border-slate-800 dark:bg-slate-950">
        <section className="flex items-center justify-center px-5 py-8 sm:px-10 lg:px-12">
          <form onSubmit={handleSubmit} className="w-full max-w-md">
            <div className="mb-8">
              <img src="/stockly-login-logo.png" alt="Stockly" className="mb-6 h-auto w-44 object-contain" />
              <p className="text-sm font-extrabold text-brand-600 dark:text-brand-200">Stockly 계정</p>
              <h1 className="mt-2 text-3xl font-black tracking-normal text-[#081238] dark:text-white">
                {mode === "login" ? "로그인" : "회원가입"}
              </h1>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                {mode === "login" ? "매장 재고관리 대시보드로 이동합니다." : "새 계정을 만들고 매장 데이터를 연결합니다."}
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-extrabold dark:bg-slate-900">
              <button type="button" onClick={() => setMode("login")} className={`rounded-md px-3 py-2.5 ${mode === "login" ? "bg-white text-brand-600 shadow-sm dark:bg-slate-800 dark:text-brand-200" : "text-slate-500 dark:text-slate-400"}`}>
                로그인
              </button>
              <button type="button" onClick={() => setMode("signup")} className={`rounded-md px-3 py-2.5 ${mode === "signup" ? "bg-white text-brand-600 shadow-sm dark:bg-slate-800 dark:text-brand-200" : "text-slate-500 dark:text-slate-400"}`}>
                회원가입
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">이메일</span>
                <input className="field border-slate-200 bg-slate-50 dark:bg-slate-900" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">비밀번호</span>
                <input className="field border-slate-200 bg-slate-50 dark:bg-slate-900" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={4} autoComplete={mode === "login" ? "current-password" : "new-password"} />
              </label>
              {mode === "signup" ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">비밀번호 확인</span>
                  <input className="field border-slate-200 bg-slate-50 dark:bg-slate-900" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={4} autoComplete="new-password" />
                </label>
              ) : null}
              {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
              {message ? <StatusMessage type="success">{message}</StatusMessage> : null}
              <button className="primary-button inline-flex w-full items-center justify-center gap-2 shadow-[0_14px_30px_rgba(87,87,255,0.24)]" type="submit" disabled={loading}>
                {loading ? (mode === "login" ? "로그인 중..." : "가입 중...") : mode === "login" ? "로그인" : "회원가입"}
                <ArrowRight size={18} />
              </button>
              {mode === "login" ? (
                <button type="button" onClick={() => void requestPasswordReset()} disabled={loading} className="touch-button w-full text-center text-sm font-bold text-brand-700 underline-offset-4 hover:underline disabled:opacity-60 dark:text-brand-100">
                  비밀번호를 잊으셨나요?
                </button>
              ) : null}
            </div>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              <span className="text-xs font-bold text-slate-400">또는</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>

            <div className="grid gap-2.5">
              {OAUTH_BUTTONS.map((item) => {
                const Icon = item.icon;
                const busy = oauthLoading === item.provider;
                return (
                  <button
                    key={item.provider}
                    type="button"
                    onClick={() => void handleOAuthLogin(item.provider)}
                    disabled={loading || oauthLoading !== null}
                    className={`touch-button inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-60 ${item.className}`}
                  >
                    {Icon ? <Icon size={18} /> : <span aria-hidden="true" className="text-lg leading-none"></span>}
                    {busy ? "이동 중..." : item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <button type="button" onClick={onOpenPrivacy} className="touch-button underline-offset-4 hover:underline">
                개인정보 처리방침
              </button>
              <button type="button" onClick={onOpenSupport} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                <Mail size={14} /> 지원 문의
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
