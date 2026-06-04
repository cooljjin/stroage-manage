import { useEffect, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { formatDateTime } from "../lib/date";
import { formatLogContent } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { InventoryLog } from "../types/domain";

export function LogsPage() {
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadLogs();
  }, []);

  async function loadLogs() {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("inventory_logs")
      .select("*, products(name, barcode)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (loadError) {
      setError(loadError.message);
    } else {
      setLogs((data ?? []) as unknown as InventoryLog[]);
    }
    setLoading(false);
  }

  return (
    <section>
      <PageTitle title="작업 로그" description="최신 작업 순서로 표시됩니다." />

      {loading ? <StatusMessage>작업 로그를 불러오는 중...</StatusMessage> : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}

      {!loading && !error ? (
        <div className="panel overflow-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="w-20 px-3 py-3">시간</th>
                <th className="w-20 px-3 py-3">직원</th>
                <th className="px-3 py-3">상품</th>
                <th className="w-16 px-3 py-3">작업</th>
                <th className="hidden px-3 py-3 sm:table-cell">내용</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(log.created_at)}</td>
                  <td className="truncate px-3 py-3 text-xs">{log.user_id.slice(0, 8)}</td>
                  <td className="px-3 py-3">
                    <span className="block truncate font-semibold">{log.products?.name ?? "삭제된 상품"}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400 sm:hidden">{formatLogContent(log)}</span>
                  </td>
                  <td className="px-3 py-3 font-bold">{log.action}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">{formatLogContent(log)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 ? <div className="p-4"><StatusMessage>작업 로그가 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}
    </section>
  );
}
