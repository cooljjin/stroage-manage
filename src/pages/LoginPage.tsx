import { FormEvent, useState } from "react";
import { ArrowRight, MessageCircle, Search } from "lucide-react";
import * as Services from "../services";
import { StatusMessage } from "../components/StatusMessage";

type OAuthProvider = "google" | "kakao" | "apple";

const OAUTH_BUTTONS: Array<{
  provider: OAuthProvider;
  label: string;
  className: string;
  icon: typeof Search;
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
];

type Props = {
  initialMode?: "login" | "signup";
  initialEmail?: string;
};

export function LoginPage({ initialMode = "login", initialEmail = "" }: Props) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
        password,
        options: {
          emailRedirectTo: window.location.origin
        }
      });
      if (signUpError) {
        setError(signUpError.message);
      } else if (!data.session) {
        setError("회원가입은 완료됐지만 자동 로그인이 되지 않았습니다. Supabase Email 설정에서 Confirm email이 꺼져 있는지 확인해 주세요.");
      } else {
        setMessage("회원가입이 완료되었습니다.");
      }
    }

    setLoading(false);
  }

  return (
    <main className="min-h-dvh bg-[#f7f8ff] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)] dark:border-slate-800 dark:bg-slate-950 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative flex min-h-[340px] flex-col justify-between overflow-hidden bg-[#070f35] px-6 py-8 text-white sm:px-10 lg:min-h-0 lg:px-12 lg:py-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(103,91,255,0.55),transparent_34%),radial-gradient(circle_at_82%_72%,rgba(14,165,233,0.24),transparent_32%)]" />
          <div className="absolute -left-24 bottom-16 h-56 w-56 rounded-full border border-white/10" />
          <div className="absolute -right-20 top-20 h-64 w-64 rounded-full border border-white/10" />

          <div className="relative">
            <div className="inline-flex rounded-2xl bg-white p-4 shadow-[0_18px_50px_rgba(36,42,255,0.26)]">
              <img src="/stockly-logo.png" alt="Stockly" className="h-auto w-56 object-contain sm:w-72 lg:w-80" />
            </div>
            <p className="mt-8 max-w-lg text-3xl font-black leading-tight tracking-normal sm:text-4xl">
              매장 재고와 발주 흐름을 한 화면에서 관리하세요.
            </p>
            <p className="mt-4 max-w-md text-base font-semibold leading-7 text-blue-100">
              입고, 출고, 부족 재고, 매장별 운영 데이터를 빠르게 동기화하는 재고관리 솔루션입니다.
            </p>
          </div>

          <div className="relative mt-10 grid grid-cols-3 gap-3 text-sm">
            {["재고 확인", "발주 준비", "매장 동기화"].map((item) => (
              <div key={item} className="rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-center font-bold text-white/90 backdrop-blur">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-10 lg:px-12">
          <form onSubmit={handleSubmit} className="w-full max-w-md">
            <div className="mb-8">
              <img src="/stockly-logo.png" alt="Stockly" className="mb-6 h-auto w-44 object-contain lg:hidden" />
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
                    <Icon size={18} />
                    {busy ? "이동 중..." : item.label}
                  </button>
                );
              })}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
