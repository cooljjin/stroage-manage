import { Boxes, LogIn, Store } from "lucide-react";

type Props = {
  onLogin: () => void;
  onSignupRequest: () => void;
};

export function LandingPage({ onLogin, onSignupRequest }: Props) {
  return (
    <main className="min-h-dvh bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="mx-auto flex min-h-dvh max-w-6xl flex-col justify-center px-5 py-12">
        <div className="mb-8 flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md bg-brand-600 text-white sm:h-20 sm:w-20">
            <Boxes size={34} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-brand-700 dark:text-brand-100 sm:text-base">통합 매장 재고관리 솔루션</p>
            <h1 className="break-words text-5xl font-black leading-none tracking-normal sm:text-7xl">StockFlow</h1>
          </div>
        </div>

        <p className="max-w-3xl text-2xl font-extrabold leading-snug text-slate-600 dark:text-slate-300 sm:text-3xl">
          재고와 발주를 더 쉽게
          <br />
          <span className="mt-4 block text-xl font-bold leading-relaxed sm:text-2xl">
            남은 재고를 확인하고
            <br />
            필요한 수량을 빠르게 발주하세요.
          </span>
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
