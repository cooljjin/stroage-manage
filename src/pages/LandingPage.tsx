import { ArrowRight, CheckCircle2, LogIn } from "lucide-react";
import { GradientText } from "../components/GradientText";

type Props = {
  onLogin: () => void;
};

export function LandingPage({ onLogin }: Props) {
  return (
    <main className="min-h-dvh bg-[#f7f8ff] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)] dark:border-slate-800 dark:bg-slate-950 lg:grid-cols-[1fr_0.92fr]">
        <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-12">
          <div className="mb-8">
            <img src="/stockly-logo.png" alt="Stockly" className="h-auto w-60 object-contain sm:w-72" />
            <p className="mt-6 text-sm font-extrabold text-brand-600 dark:text-brand-200">통합 매장 재고관리 솔루션</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-black leading-tight tracking-normal text-[#081238] sm:text-5xl">
              <GradientText colors={["#5757FF", "#7C7BFF", "#8D8CFF"]} animationSpeed={8}>
                재고와 발주를 더 쉽게
              </GradientText>
            </h1>
          </div>

          <p className="max-w-xl text-xl font-bold leading-relaxed text-slate-600 dark:text-slate-300 sm:text-2xl">
            남은 재고를 확인하고
            <br />
            필요한 수량을 빠르게 발주하세요.
          </p>

          <div className="mt-7 grid max-w-xl gap-3 sm:grid-cols-3">
            {["실시간 재고", "부족 품목 확인", "매장 데이터 동기화"].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-extrabold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                <CheckCircle2 size={17} className="shrink-0 text-brand-600" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <button type="button" onClick={onLogin} className="primary-button inline-flex w-full items-center justify-center gap-2 px-8 shadow-[0_14px_30px_rgba(87,87,255,0.24)] sm:w-auto">
              <LogIn size={19} />
              로그인
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <div className="relative hidden min-h-full overflow-hidden bg-[#070f35] p-10 text-white lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,rgba(103,91,255,0.58),transparent_35%),radial-gradient(circle_at_78%_78%,rgba(14,165,233,0.25),transparent_34%)]" />
          <div className="absolute -right-24 top-20 h-72 w-72 rounded-full border border-white/10" />
          <div className="absolute -bottom-24 left-10 h-72 w-72 rounded-full border border-white/10" />

          <div className="relative flex h-full items-center">
            <div className="grid w-full gap-4">
              {[
                ["오늘 입고", "매장별 재고 변동을 빠르게 기록"],
                ["발주 준비", "부족 품목과 필요 수량을 한눈에 확인"],
                ["운영 기록", "직원별 처리 내역을 안전하게 저장"]
              ].map(([title, description]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <p className="text-lg font-black">{title}</p>
                  <p className="mt-1 text-sm font-semibold text-blue-100">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
