import { Boxes, Mail, ShieldCheck } from "lucide-react";

const lastUpdated = "2026-07-17";

const sections = [
  {
    title: "수집하는 정보",
    body: [
      "이메일 주소, 로그인 및 계정 관리에 필요한 계정 정보를 수집합니다.",
      "서비스 이용 중 사용자가 입력하거나 생성하는 매장 정보, 재고 품목, 수량, 입출고 기록, 발주 및 운영 관련 데이터를 수집합니다."
    ]
  },
  {
    title: "수집 및 이용 목적",
    body: [
      "회원 인증, 로그인, 계정 생성 및 권한 관리를 위해 사용합니다.",
      "매장별 재고 관리, 데이터 동기화, 서비스 제공, 오류 확인 및 안정적인 운영을 위해 사용합니다."
    ]
  },
  {
    title: "제3자 처리업체",
    body: [
      "Supabase를 인증, 데이터베이스, 파일 저장 등 서비스 운영을 위한 처리업체로 사용합니다.",
      "Supabase는 서비스 제공에 필요한 범위 내에서 데이터를 처리하며, 앱 운영자는 광고 목적의 추적을 위해 이 정보를 사용하지 않습니다."
    ]
  },
  {
    title: "보관 기간",
    body: [
      "계정 정보와 매장/재고 데이터는 서비스 제공 및 법적 의무 이행에 필요한 기간 동안 보관됩니다.",
      "개인 매장 계정의 탈퇴 요청은 30일 동안 복구할 수 있도록 보관한 뒤, 관련 법령상 보관이 필요한 정보를 제외하고 계정과 매장 데이터를 삭제합니다. 공동 매장 구성원은 관리자 이관 후 계정이 삭제되며, 공동 운영 기록은 작성자 정보를 익명화해 보관할 수 있습니다."
    ]
  },
  {
    title: "보안",
    body: [
      "데이터는 Supabase의 인증 및 접근 제어 기능을 통해 보호되며, 매장별 권한에 따라 접근이 제한됩니다.",
      "앱 운영자는 무단 접근, 변경, 공개 또는 파기를 방지하기 위해 합리적인 기술적 및 관리적 보호 조치를 적용합니다."
    ]
  },
  {
    title: "사용자 권리 및 문의",
    body: [
      "사용자는 본인의 개인정보 열람, 수정, 삭제 또는 계정 삭제를 요청할 수 있습니다.",
      "개인정보 관련 문의는 앱 운영자에게 이메일로 연락해 주세요. 문의 이메일: jich980611@gmail.com"
    ]
  }
];

export function PrivacyPolicyPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
      <section className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-brand-600 text-white sm:h-16 sm:w-16">
            <Boxes size={30} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-brand-700 dark:text-brand-100">통합 매장 재고관리 솔루션</p>
            <h1 className="mt-1 break-words text-4xl font-black leading-tight tracking-normal sm:text-5xl">개인정보 처리방침</h1>
            <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">Last updated: {lastUpdated}</p>
          </div>
        </div>

        <div className="panel p-5 sm:p-6">
          <div className="flex items-start gap-3 border-b border-slate-200 pb-5 dark:border-slate-800">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
              <ShieldCheck size={21} />
            </div>
            <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
              StockFlow는 매장 재고관리 서비스를 제공하기 위해 필요한 최소한의 정보를 수집하고, 수집한 정보는 아래 목적에 따라 처리합니다.
            </p>
          </div>

          <div className="mt-6 grid gap-6">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-100">{section.title}</h2>
                <ul className="mt-3 grid gap-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  {section.body.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Mail size={20} className="text-brand-700 dark:text-brand-100" />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">개인정보 문의</span>
            </div>
            <a className="text-sm font-extrabold text-brand-700 underline-offset-4 hover:underline dark:text-brand-100" href="mailto:jich980611@gmail.com">
              jich980611@gmail.com
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
