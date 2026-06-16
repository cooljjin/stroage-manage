import { ArrowLeft } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";

type Props = {
  onBack: () => void;
};

export function SignupRequestPage({ onBack }: Props) {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-xl">
        <button type="button" onClick={onBack} className="secondary-button mb-4 inline-flex items-center gap-2">
          <ArrowLeft size={18} />
          뒤로
        </button>
        <PageTitle title="신규 매장 신청" description="마스터가 승인한 뒤 매장과 관리자 계정을 생성합니다." />
        <div className="panel p-4">
          <StatusMessage>신청 폼은 다음 단계에서 연결합니다. 지금은 초대 기반 가입을 우선 적용합니다.</StatusMessage>
        </div>
      </div>
    </main>
  );
}
