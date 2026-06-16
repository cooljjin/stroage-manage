import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";

export function MasterStoresPage() {
  return (
    <section>
      <PageTitle title="전체 매장" description="마스터 계정에서 모든 매장을 관리합니다." />
      <div className="panel p-4">
        <StatusMessage>매장 생성/수정 화면은 DB 마이그레이션 적용 후 연결합니다.</StatusMessage>
      </div>
    </section>
  );
}
