import { useCallback, useEffect, useMemo, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { formatDateTime } from "../lib/date";
import { formatLogContent } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { InventoryLog, InventoryLogWithStaff, Product, StaffProfile } from "../types/domain";

type LogPeriod = "day" | "week" | "month";

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

export function LogsPage() {
  const [logs, setLogs] = useState<InventoryLogWithStaff[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [period, setPeriod] = useState<LogPeriod>("day");
  const [baseDate, setBaseDate] = useState(() => formatDateInputValue(new Date()));
  const [productId, setProductId] = useState("all");
  const [staffId, setStaffId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const range = useMemo(() => getLogRange(period, baseDate), [baseDate, period]);

  async function loadFilterOptions() {
    const [productResult, profileResult] = await Promise.all([
      supabase.from("products").select("*").order("name", { ascending: true }),
      supabase.from("profiles").select("*").order("display_name", { ascending: true })
    ]);

    if (!productResult.error) setProducts((productResult.data ?? []) as Product[]);
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

    if (productId !== "all") {
      query = query.eq("product_id", productId);
    }

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
  }, [productId, range.end, range.start, staffId]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    void loadFilterOptions();
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
            <select className="field" value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="all">전체 상품</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
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
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(log.created_at)}</td>
                  <td className="truncate px-3 py-3 text-xs">{log.staff_name}</td>
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
