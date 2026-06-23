import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { formatDateTime } from "../lib/date";
import { formatLogContent } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, InventoryLog, InventoryLogWithStaff, StaffProfile } from "../types/domain";

type LogPeriod = "day" | "week" | "month";

type Props = {
  navigate: (route: AppRoute) => void;
};

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLogRange(period: LogPeriod, baseDateValue: string): { start: Date; end: Date; label: string } {
  const baseDate = new Date(`${baseDateValue}T00:00:00`);
  const start = new Date(baseDate);
  const end = new Date(baseDate);

  if (period === "day") {
    end.setDate(start.getDate() + 1);
    return { start, end, label: new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(start) };
  }

  if (period === "week") {
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
    const formatter = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" });
    return { start, end, label: `${formatter.format(start)} - ${formatter.format(new Date(end.getTime() - 1))}` };
  }

  start.setDate(1);
  end.setTime(start.getTime());
  end.setMonth(start.getMonth() + 1);
  return { start, end, label: new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(start) };
}

export function LogsPage({ navigate }: Props) {
  const [logs, setLogs] = useState<InventoryLogWithStaff[]>([]);
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [period, setPeriod] = useState<LogPeriod>("day");
  const [baseDate, setBaseDate] = useState(() => formatDateInputValue(new Date()));
  const [productSearch, setProductSearch] = useState("");
  const [staffId, setStaffId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const range = useMemo(() => getLogRange(period, baseDate), [baseDate, period]);
  const filteredLogs = useMemo(() => {
    const keyword = productSearch.trim().toLocaleLowerCase("ko");
    if (!keyword) return logs;

    return logs.filter((log) => {
      const productName = log.products?.name ?? "삭제된 상품";
      const barcode = log.products?.barcode ?? "";
      return productName.toLocaleLowerCase("ko").includes(keyword) || barcode.toLocaleLowerCase("ko").includes(keyword);
    });
  }, [logs, productSearch]);

  async function loadProfiles() {
    const profileResult = await supabase.from("profiles").select("*").order("display_name", { ascending: true });

    if (!profileResult.error) setProfiles((profileResult.data ?? []) as StaffProfile[]);
  }

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError("");

    let query = supabase
      .from("inventory_logs")
      .select("*, products(name, barcode)")
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString());

    if (staffId !== "all") {
      query = query.eq("user_id", staffId);
    }

    const { data, error: loadError } = await query.order("created_at", { ascending: false }).limit(500);

    if (loadError) {
      setError(loadError.message);
    } else {
      const nextLogs = (data ?? []) as unknown as InventoryLog[];
      const userIds = Array.from(new Set(nextLogs.map((log) => log.user_id)));
      const { data: profiles } = await supabase.from("profiles").select("*").in("id", userIds);
      const profileMap = new Map((profiles ?? []).map((profile: StaffProfile) => [profile.id, profile.display_name]));

      setLogs(
        nextLogs.map((log) => ({
          ...log,
          staff_name: profileMap.get(log.user_id) ?? log.user_id.slice(0, 8)
        }))
      );
    }
    setLoading(false);
  }, [range.end, range.start, staffId]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    void loadProfiles();
  }, []);

  return (
    <section>
      <PageTitle title="작업 로그" description={`${range.label} 작업 내역입니다.`} />

      <div className="mb-4 space-y-3">
        <div className="grid grid-cols-3 rounded-md border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          {[
            ["day", "일"],
            ["week", "주"],
            ["month", "월"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value as LogPeriod)}
              className={`touch-button rounded px-3 text-sm font-bold ${period === value ? "bg-brand-600 text-white" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">기준일</span>
            <input className="field" type="date" value={baseDate} onChange={(event) => setBaseDate(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">상품</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                className="field pl-10"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="상품명 또는 바코드 검색"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">직원</span>
            <select className="field" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
              <option value="all">전체 직원</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.display_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

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
              {filteredLogs.map((log) => (
                <tr key={log.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(log.created_at)}</td>
                  <td className="truncate px-3 py-3 text-xs">{log.staff_name}</td>
                  <td className="px-3 py-3">
                    {log.products && !log.action.startsWith("프랩") ? (
                      <button
                        type="button"
                        onClick={() => navigate({ name: "operation", productId: log.product_id })}
                        className="block max-w-full truncate text-left font-semibold text-brand-700 hover:underline dark:text-brand-100"
                      >
                        {log.products.name}
                      </button>
                    ) : log.products ? (
                      <span className="block truncate font-semibold">{log.products.name}</span>
                    ) : (
                      <span className="block truncate font-semibold">삭제된 상품</span>
                    )}
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400 sm:hidden">{formatLogContent(log)}</span>
                  </td>
                  <td className="px-3 py-3 font-bold">{log.action}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">{formatLogContent(log)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredLogs.length === 0 ? (
            <div className="p-4">
              <StatusMessage>{productSearch.trim() ? "검색 조건에 맞는 작업 로그가 없습니다." : "작업 로그가 없습니다."}</StatusMessage>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
