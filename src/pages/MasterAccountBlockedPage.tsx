import { LogOut } from "lucide-react";

type Props = {
  onLogout: () => void;
};

export function MasterAccountBlockedPage({ onLogout }: Props) {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-black">운영자 계정입니다.</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">운영자 계정은 고객용 Stockly 앱에서 사용할 수 없습니다.</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">운영자 업무는 별도 관리자 콘솔에서 처리해 주세요.</p>
        <button type="button" onClick={onLogout} className="secondary-button mt-6 inline-flex w-full items-center justify-center gap-2">
          <LogOut size={18} />
          로그아웃
        </button>
      </section>
    </main>
  );
}
