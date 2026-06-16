import { Boxes, LogIn, Store } from "lucide-react";

type Props = {
  onLogin: () => void;
  onSignupRequest: () => void;
};

export function LandingPage({ onLogin, onSignupRequest }: Props) {
  return (
    <main className="min-h-dvh bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-brand-600 text-white">
            <Boxes size={22} />
          </div>
          <div>
            <p className="text-xs font-bold text-brand-700 dark:text-brand-100">매장 재고관리</p>
            <h1 className="text-3xl font-black sm:text-5xl">여러 매장을 한 곳에서 관리</h1>
          </div>
        </div>

        <p className="max-w-2xl text-base font-medium leading-7 text-slate-600 dark:text-slate-300 sm:text-lg">
          마스터 계정은 전체 매장을 관리하고, 각 매장 관리자는 직원과 환경설정을 관리합니다.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onLogin} className="primary-button inline-flex items-center justify-center gap-2">
            <LogIn size={19} />
            로그인
          </button>
          <button type="button" onClick={onSignupRequest} className="secondary-button inline-flex items-center justify-center gap-2">
            <Store size={19} />
            신규 매장 신청
          </button>
        </div>
      </section>
    </main>
  );
}
