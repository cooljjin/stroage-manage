import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";

export function MasterUsersPage() {
  return (
    <section>
      <PageTitle title="전체 사용자" description="마스터 계정에서 매장별 관리자와 직원을 확인합니다." />
      <div className="panel p-4">
        <StatusMessage>전체 사용자 관리는 다음 단계에서 매장 필터와 함께 연결합니다.</StatusMessage>
      </div>
    </section>
  );
}
