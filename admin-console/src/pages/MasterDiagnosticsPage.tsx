import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { PageTitle } from "../../../src/components/PageTitle";
import { StatusMessage } from "../../../src/components/StatusMessage";
import * as Services from "../../../src/services";
import type { Store } from "../../../src/types/domain";
import type { Database } from "../../../src/types/supabase";

type DiagnosticRow = Database["public"]["Functions"]["diagnose_store_consistency"]["Returns"][number];

const ISSUE_LABELS: Record<string, string> = {
  inventory_quantity_mismatch: "재고 수량 불일치",
  confirmed_order_pending_mismatch: "컨펌 진행 상태 불일치"
};

function formatJson(value: unknown) {
  return JSON.stringify(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export function MasterDiagnosticsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [rows, setRows] = useState<DiagnosticRow[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [selectedStoreId, stores]
  );

  useEffect(() => {
    let cancelled = false;

    void Services.DatabaseService.select("stores", "*")
      .eq("status", "active")
      .order("name", { ascending: true })
      .then((result: { data: unknown; error: { message: string } | null }) => {
        if (cancelled) return;
        const { data, error: loadError } = result;
        if (loadError) {
          setError(loadError.message);
        } else {
          const nextStores = (data ?? []) as Store[];
          setStores(nextStores);
          setSelectedStoreId((current) => current || nextStores[0]?.id || "");
        }
        setLoadingStores(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function runDiagnosis() {
    if (!selectedStoreId) return;
    setLoading(true);
    setError("");
    setMessage("");

    const { data, error: diagnosisError } = await Services.DatabaseService.rpc("diagnose_store_consistency", {
      target_store_id: selectedStoreId
    });

    if (diagnosisError) {
      setError(diagnosisError.message);
    } else {
      setRows((data ?? []) as DiagnosticRow[]);
      setMessage(`진단을 완료했습니다. 불일치 ${data?.length ?? 0}건입니다.`);
    }

    setLoading(false);
  }

  function downloadCsv() {
    if (!selectedStore || rows.length === 0) return;

    const header = ["매장", "상품 ID", "상품명", "불일치 종류", "기대값", "실제값", "마지막 변경 시각"];
    const body = rows.map((row) => [
      selectedStore.name,
      row.product_id,
      row.product_name,
      ISSUE_LABELS[row.issue_type] ?? row.issue_type,
      formatJson(row.expected_value),
      formatJson(row.actual_value),
      formatDate(row.last_changed_at)
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stockly-diagnostics-${selectedStore.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <PageTitle
        title="데이터 진단"
        description="재고 현재값과 마지막 유효 로그, 확정 발주 상태를 읽기 전용으로 비교합니다. 자동 수정은 수행하지 않습니다."
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">진단 매장</span>
          <select
            className="field"
            value={selectedStoreId}
            onChange={(event) => setSelectedStoreId(event.target.value)}
            disabled={loadingStores || stores.length === 0}
          >
            <option value="" disabled>매장을 선택해 주세요</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void runDiagnosis()} className="primary-button inline-flex items-center justify-center gap-2" disabled={!selectedStoreId || loading}>
          <RefreshCw size={18} className={loading ? "animate-spin" : undefined} />
          {loading ? "진단 중..." : "재검사"}
        </button>
        <button type="button" onClick={downloadCsv} className="secondary-button inline-flex items-center justify-center gap-2" disabled={rows.length === 0}>
          <Download size={18} />
          CSV 내보내기
        </button>
      </div>

      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}
      {loadingStores ? <StatusMessage>매장 목록을 불러오는 중...</StatusMessage> : null}

      {!loadingStores && rows.length === 0 ? (
        <div className="panel p-8 text-center">
          <Search className="mx-auto text-brand-600" size={28} />
          <p className="mt-3 font-bold">진단 결과가 없습니다.</p>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">매장을 선택하고 재검사를 실행해 주세요.</p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="px-3 py-3">상품명</th>
                <th className="px-3 py-3">불일치 종류</th>
                <th className="px-3 py-3">기대값</th>
                <th className="px-3 py-3">실제값</th>
                <th className="px-3 py-3">마지막 변경</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.product_id}-${row.issue_type}`} className="border-t border-slate-100 align-top dark:border-slate-900">
                  <td className="px-3 py-3"><span className="block font-bold">{row.product_name}</span><span className="block text-xs text-slate-500">{row.product_id}</span></td>
                  <td className="px-3 py-3 font-semibold">{ISSUE_LABELS[row.issue_type] ?? row.issue_type}</td>
                  <td className="max-w-[260px] whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs">{formatJson(row.expected_value)}</td>
                  <td className="max-w-[260px] whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs">{formatJson(row.actual_value)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{formatDate(row.last_changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
