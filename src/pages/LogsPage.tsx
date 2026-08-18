import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { formatDateTime } from "../lib/date";
import { formatInventoryActionLabel, formatInventoryQuantity, formatLogContent } from "../lib/inventory";
import { finishMappedMutationRequest, getMappedMutationRequestId } from "../lib/mutationRequest";
import { resolveStoreStaffNames } from "../lib/staffNames";
import * as Services from "../services";
import type { AppRoute, InventoryLog, InventoryLogWithStaff, StaffProfile } from "../types/domain";

type LogPeriod = "day" | "week" | "month";
type LogKind = "all" | "basic" | "prep";

function getMobileSessionModes(logs: InventoryLogWithStaff[]): string[] {
  return Array.from(new Set(logs.map((log) => log.action === "이동" ? "이동" : log.action === "조정" ? "실사" : "자동")));
}

function formatMobileSessionAction(logs: InventoryLogWithStaff[]): string {
  return getMobileSessionModes(logs).join("/") || "재고 작업";
}

function formatMobileSessionContent(logs: InventoryLogWithStaff[]): string {
  const first = [...logs].sort((left, right) => (left.mobile_session_sequence ?? 0) - (right.mobile_session_sequence ?? 0))[0];
  const last = [...logs].sort((left, right) => (right.mobile_session_sequence ?? 0) - (left.mobile_session_sequence ?? 0))[0];
  const warehouseBefore = first?.warehouse_qty_before ?? 0;
  const storeBefore = first?.store_qty_before ?? 0;
  const warehouseAfter = last?.warehouse_qty_after ?? warehouseBefore;
  const storeAfter = last?.store_qty_after ?? storeBefore;
  return `${formatMobileSessionAction(logs)} · 창고 ${formatInventoryQuantity(warehouseBefore)} → ${formatInventoryQuantity(warehouseAfter)} · 매장 ${formatInventoryQuantity(storeBefore)} → ${formatInventoryQuantity(storeAfter)}`;
}

type Props = {
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
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

export function LogsPage({ navigate, currentStoreId }: Props) {
  const [logs, setLogs] = useState<InventoryLogWithStaff[]>([]);
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [period, setPeriod] = useState<LogPeriod>("day");
  const [baseDate, setBaseDate] = useState(() => formatDateInputValue(new Date()));
  const [productSearch, setProductSearch] = useState("");
  const [staffId, setStaffId] = useState("all");
  const [logKind, setLogKind] = useState<LogKind>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("");
  const restoreMutationRequestRef = useRef(new Map<string, string>());

  const range = useMemo(() => getLogRange(period, baseDate), [baseDate, period]);
  const filteredLogs = useMemo(() => {
    const keyword = productSearch.trim().toLocaleLowerCase("ko");

    const matchingLogs = logs.filter((log) => {
      const productName = log.products?.name ?? "삭제된 상품";
      const barcode = log.products?.barcode ?? "";
      const keywordMatch = !keyword || productName.toLocaleLowerCase("ko").includes(keyword) || barcode.toLocaleLowerCase("ko").includes(keyword);
      const kindMatch = logKind === "all" || (logKind === "prep" ? log.action.startsWith("프랩") : !log.action.startsWith("프랩"));
      return keywordMatch && kindMatch;
    });
    const seenSessions = new Set<string>();
    return matchingLogs.filter((log) => {
      if (!log.mobile_session_id) return true;
      if (seenSessions.has(log.mobile_session_id)) return false;
      seenSessions.add(log.mobile_session_id);
      return true;
    });
  }, [logKind, logs, productSearch]);

  const mobileSessionLogs = useMemo(() => {
    const grouped = new Map<string, InventoryLogWithStaff[]>();
    logs.forEach((log) => {
      if (!log.mobile_session_id) return;
      const current = grouped.get(log.mobile_session_id) ?? [];
      current.push(log);
      grouped.set(log.mobile_session_id, current);
    });
    return grouped;
  }, [logs]);

  async function restoreMobileSession(log: InventoryLogWithStaff) {
    if (!log.mobile_session_id) return;
    const sessionLogs = mobileSessionLogs.get(log.mobile_session_id) ?? [log];
    const last = [...sessionLogs].sort((left, right) => (right.mobile_session_sequence ?? 0) - (left.mobile_session_sequence ?? 0))[0] ?? log;
    const restoredWarehouseQty = last.warehouse_qty_after ?? last.warehouse_qty_before ?? 0;
    const restoredStoreQty = last.store_qty_after ?? last.store_qty_before ?? 0;
    setRestoringSessionId(log.mobile_session_id);
    setRestoreMessage("");
    setError("");
    const { data: inventoryData, error: inventoryError } = await Services.DatabaseService.select("inventory", "warehouse_version, store_version")
      .eq("store_id", currentStoreId)
      .eq("product_id", log.product_id)
      .single();

    if (inventoryError || !inventoryData) {
      setError(inventoryError?.message ?? "재고 정보를 찾을 수 없습니다.");
      setRestoringSessionId(null);
      return;
    }

    if (!window.confirm(`재고 작업을 ${formatDateTime(last.created_at)} 시점으로 복원하시겠습니까?\n창고 ${formatInventoryQuantity(restoredWarehouseQty)} / 매장 ${formatInventoryQuantity(restoredStoreQty)}\n선택 시점 이후 작업은 히스토리에서 취소 처리됩니다.`)) {
      setRestoringSessionId(null);
      return;
    }

    const restoreKey = `session:${log.mobile_session_id}`;
    const requestId = getMappedMutationRequestId(restoreMutationRequestRef, restoreKey);
    const { error: restoreError } = await Services.DatabaseService.rpc("restore_inventory_to_mobile_session_v2", {
      target_session_id: log.mobile_session_id,
      restored_warehouse_qty: restoredWarehouseQty,
      restored_store_qty: restoredStoreQty,
      expected_warehouse_version: inventoryData.warehouse_version,
      expected_store_version: inventoryData.store_version,
      request_id: requestId
    });

    if (restoreError) {
      finishMappedMutationRequest(restoreMutationRequestRef, restoreKey, restoreError);
      setError(restoreError.message);
    } else {
      restoreMutationRequestRef.current.delete(restoreKey);
      setRestoreMessage("재고 작업을 복원했습니다.");
      await loadLogs();
    }
    setRestoringSessionId(null);
  }

  const loadProfiles = useCallback(async () => {
    const profileResult = await Services.DatabaseService.select("profiles", "*").eq("store_id", currentStoreId).order("display_name", { ascending: true });

    if (!profileResult.error) setProfiles((profileResult.data ?? []) as StaffProfile[]);
  }, [currentStoreId]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError("");

    let query = Services.DatabaseService.select("inventory_logs", "*, products(name, barcode)")
      .eq("store_id", currentStoreId)
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
      const profileMap = await resolveStoreStaffNames(currentStoreId, userIds);

      setLogs(
        nextLogs.map((log) => ({
          ...log,
          staff_name: profileMap.get(log.user_id) ?? "직원"
        }))
      );
    }
    setLoading(false);
  }, [currentStoreId, range.end, range.start, staffId]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

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

        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[0.9fr_1.4fr_1fr_0.9fr]">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">기준일</span>
            <input className="field block min-w-0 max-w-full appearance-none" type="date" value={baseDate} onChange={(event) => setBaseDate(event.target.value)} />
          </label>
          <label className="block min-w-0">
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
          <label className="block min-w-0">
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
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">구분</span>
            <select className="field" value={logKind} onChange={(event) => setLogKind(event.target.value as LogKind)}>
              <option value="all">전체</option>
              <option value="basic">기본</option>
              <option value="prep">프랩</option>
            </select>
          </label>
        </div>
      </div>

      {loading ? <StatusMessage>작업 로그를 불러오는 중...</StatusMessage> : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
      {restoreMessage ? <StatusMessage type="success">{restoreMessage}</StatusMessage> : null}

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
                <th className="w-16 px-3 py-3">복원</th>
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
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400 sm:hidden">
                      {log.mobile_session_id ? formatMobileSessionContent(mobileSessionLogs.get(log.mobile_session_id) ?? [log]) : formatLogContent(log)}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-bold">{log.mobile_session_id ? formatMobileSessionAction(mobileSessionLogs.get(log.mobile_session_id) ?? [log]) : formatInventoryActionLabel(log.action)}</td>
                  <td className="hidden px-3 py-3 sm:table-cell">{log.mobile_session_id ? formatMobileSessionContent(mobileSessionLogs.get(log.mobile_session_id) ?? [log]) : formatLogContent(log)}</td>
                  <td className="px-3 py-3">
                    {log.mobile_session_id ? (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void restoreMobileSession(log)}
                        disabled={restoringSessionId === log.mobile_session_id}
                        aria-label="재고 작업 복원"
                        title="재고 작업 복원"
                      >
                        <RotateCcw size={16} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredLogs.length === 0 ? (
            <div className="p-4">
              <StatusMessage>{productSearch.trim() || logKind !== "all" ? "검색 조건에 맞는 작업 로그가 없습니다." : "작업 로그가 없습니다."}</StatusMessage>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
