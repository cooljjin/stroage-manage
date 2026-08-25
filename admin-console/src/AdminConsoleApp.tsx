import { FormEvent, useEffect, useState } from "react";
import { Activity, BrainCircuit, LogIn, LogOut, Store, Users } from "lucide-react";
import * as Services from "../../src/services";
import { ensureCurrentProfile } from "../../src/lib/profiles";
import { StatusMessage } from "../../src/components/StatusMessage";
import type { Session } from "../../src/services";
import type { StaffProfile } from "../../src/types/domain";
import { MasterStoresPage } from "./pages/MasterStoresPage";
import { MasterUsersPage } from "./pages/MasterUsersPage";
import { MasterDiagnosticsPage } from "./pages/MasterDiagnosticsPage";
import { MasterRecipeApprovalsPage } from "./pages/MasterRecipeApprovalsPage";

type ConsoleView = "stores" | "users" | "recipe-approvals" | "diagnostics";

function getProfileRole(profile: StaffProfile) {
  return profile.role ?? (profile.is_admin ? "store_admin" : "staff");
}

function AdminLoginPage({ onSubmit, loading, error }: {
  onSubmit: (email: string, password: string) => void;
  loading: boolean;
  error: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(email, password);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f8ff] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] dark:border-slate-800 dark:bg-slate-950 sm:p-8">
        <div className="mb-8">
          <p className="text-sm font-extrabold text-brand-600 dark:text-brand-200">Stockly 운영 콘솔</p>
          <h1 className="mt-2 text-3xl font-black text-[#081238] dark:text-white">관리자 로그인</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">서비스 운영자 계정만 사용할 수 있습니다.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold">이메일</span>
            <input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold">비밀번호</span>
            <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
          </label>
          {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
          <button type="submit" className="primary-button inline-flex w-full items-center justify-center gap-2" disabled={loading}>
            <LogIn size={18} />
            {loading ? "로그인 중..." : "관리자 로그인"}
          </button>
        </form>
      </section>
    </main>
  );
}

function MasterOnlyMessage({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-black">접근 권한이 없습니다.</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">Stockly 운영 콘솔은 master 계정만 사용할 수 있습니다.</p>
        <button type="button" onClick={onLogout} className="secondary-button mt-6 inline-flex w-full items-center justify-center gap-2">
          <LogOut size={18} />
          로그아웃
        </button>
      </section>
    </main>
  );
}

export default function AdminConsoleApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<ConsoleView>("stores");

  useEffect(() => {
    let cancelled = false;

    Services.AuthService.getSession().then(({ data, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = Services.AuthService.onAuthStateChange((_event, nextSession) => {
      if (!cancelled) {
        setSession(nextSession);
        setProfile(null);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    setError("");
    void ensureCurrentProfile(session).then((nextProfile) => {
      if (cancelled) return;
      if (!nextProfile) {
        setError("운영자 프로필을 찾지 못했습니다.");
      }
      setProfile(nextProfile);
      setProfileLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleLogin(email: string, password: string) {
    setLoginLoading(true);
    setError("");
    const { error: loginError } = await Services.AuthService.signInWithPassword({ email: email.trim(), password });
    if (loginError) setError(loginError.message);
    setLoginLoading(false);
  }

  async function handleLogout() {
    await Services.AuthService.logout();
    setSession(null);
    setProfile(null);
    setError("");
  }

  if (authLoading) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">로딩 중...</div>;
  }

  if (!session) {
    return <AdminLoginPage onSubmit={(email, password) => void handleLogin(email, password)} loading={loginLoading} error={error} />;
  }

  if (profileLoading || !profile) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">{profileLoading ? "운영자 권한을 확인하는 중..." : error || "프로필을 확인할 수 없습니다."}</div>;
  }

  if (getProfileRole(profile) !== "master") {
    return <MasterOnlyMessage onLogout={() => void handleLogout()} />;
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-200">Stockly</p>
            <h1 className="mt-1 text-xl font-black">운영 관리자 콘솔</h1>
          </div>
          <button type="button" onClick={() => void handleLogout()} className="secondary-button inline-flex items-center gap-2">
            <LogOut size={17} />
            로그아웃
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <nav className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="관리자 메뉴">
          <button type="button" onClick={() => setView("stores")} className={`touch-button inline-flex items-center justify-center gap-2 rounded-md border px-4 text-sm font-bold ${view === "stores" ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
            <Store size={18} />
            전체 매장
          </button>
          <button type="button" onClick={() => setView("users")} className={`touch-button inline-flex items-center justify-center gap-2 rounded-md border px-4 text-sm font-bold ${view === "users" ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
            <Users size={18} />
            전체 사용자
          </button>
          <button type="button" onClick={() => setView("diagnostics")} className={`touch-button inline-flex items-center justify-center gap-2 rounded-md border px-4 text-sm font-bold ${view === "diagnostics" ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
            <Activity size={18} />
            데이터 진단
          </button>
          <button type="button" onClick={() => setView("recipe-approvals")} className={`touch-button inline-flex items-center justify-center gap-2 rounded-md border px-4 text-sm font-bold ${view === "recipe-approvals" ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
            <BrainCircuit size={18} />
            AI 분석 승인
          </button>
        </nav>
        {view === "stores"
          ? <MasterStoresPage />
          : view === "users"
            ? <MasterUsersPage />
            : view === "recipe-approvals"
              ? <MasterRecipeApprovalsPage />
              : <MasterDiagnosticsPage />}
      </main>
    </div>
  );
}
