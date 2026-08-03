import { Boxes, Mail, MessageCircleQuestion } from "lucide-react";

const SUPPORT_EMAIL = "jich980611@gmail.com";

export function SupportPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
      <section className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-brand-600 text-white sm:h-16 sm:w-16">
            <Boxes size={30} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-brand-700 dark:text-brand-100">Stockly</p>
            <h1 className="mt-1 text-4xl font-black leading-tight sm:text-5xl">지원 문의</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">로그인, 계정, 재고 관리 기능 이용 중 도움이 필요하면 이메일로 문의해 주세요.</p>
          </div>
        </div>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
              <MessageCircleQuestion size={21} />
            </div>
            <div>
              <h2 className="text-lg font-extrabold">문의 방법</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">사용 중인 기기, 발생한 화면과 오류 내용을 함께 보내 주시면 확인에 도움이 됩니다.</p>
            </div>
          </div>

          <a className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-brand-700" href={`mailto:${SUPPORT_EMAIL}?subject=Stockly%20지원%20문의`}>
            <Mail size={18} /> {SUPPORT_EMAIL}
          </a>
        </section>
      </section>
    </main>
  );
}
