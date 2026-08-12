import { LogOut, Mail } from "lucide-react";

type Props = {
  onLogout: () => void;
  onOpenSupport: () => void;
};

export function MasterAccountBlockedPage({ onLogout, onOpenSupport }: Props) {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-black">운영 전용 계정입니다.</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">현재 계정은 고객용 매장 기능을 사용할 수 없습니다.</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">고객용 계정으로 다시 로그인해 주세요.</p>
        <div className="mt-6 grid gap-2">
          <button type="button" onClick={onOpenSupport} className="secondary-button inline-flex w-full items-center justify-center gap-2">
            <Mail size={18} />
            지원 문의
          </button>
          <button type="button" onClick={onLogout} className="secondary-button inline-flex w-full items-center justify-center gap-2">
            <LogOut size={18} />
            로그아웃
          </button>
        </div>
      </section>
    </main>
  );
}
