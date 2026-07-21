import { addDateValueDays, getDateValueWeekday, getSeoulDateValue } from "../../lib/businessCalendar";
import type { DashboardTodo, GroupOrderEvent, GroupOrderEventItem, GroupOrderMenu, InventoryLog, Location } from "../../types/domain";
import { DatabaseService } from "../database/DatabaseService";

export type TimelineEventType = "receipt" | "todo-completed" | "todo-planned" | "group-order" | "prep-production" | "prep-disposal" | "inventory-adjustment" | "memo";

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  occurredAt: string | null;
  title: string;
  detail: string;
  staffId: string | null;
};

export type TimelineDay = {
  date: string;
  events: TimelineEvent[];
};

export type TimelineMonth = {
  days: Map<string, TimelineDay>;
  staffNames: Map<string, string>;
};

type TimelineInventoryLog = InventoryLog & {
  products: Pick<NonNullable<InventoryLog["products"]>, "name"> | null;
};

function getSeoulDayRange(dateValue: string) {
  const start = new Date(`${dateValue}T00:00:00+09:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function addEvent(days: Map<string, TimelineDay>, date: string, event: TimelineEvent) {
  const day = days.get(date) ?? { date, events: [] };
  day.events.push(event);
  days.set(date, day);
}

function formatQuantity(value: number | null) {
  return value === null ? "수량 확인" : `${value}`;
}

function formatLocation(location: Location | null) {
  return location ? ` · ${location}` : "";
}

async function resolveStaffNames(storeId: string, userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return new Map<string, string>();

  const { data } = await DatabaseService.rpc("resolve_store_staff_names", {
    target_store_id: storeId,
    user_ids: uniqueUserIds
  });
  return new Map(((data ?? []) as Array<{ user_id: string; display_name: string }>).map((row) => [row.user_id, row.display_name]));
}

export const TimelineService = {
  async getMonthTimeline(storeId: string, monthStartDate: string): Promise<{ data: TimelineMonth | null; error: Error | null }> {
    const rangeStartDate = addDateValueDays(monthStartDate, -getDateValueWeekday(monthStartDate));
    const rangeEndDate = addDateValueDays(rangeStartDate, 41);
    const range = getSeoulDayRange(rangeStartDate);
    const endRange = getSeoulDayRange(rangeEndDate);
    const [logResult, completedTodoResult, plannedTodoResult, groupOrderResult] = await Promise.all([
      DatabaseService.select("inventory_logs", "*, products(name)")
        .eq("store_id", storeId)
        .is("reverted_at", null)
        .in("action", ["입고", "프랩 제조", "프랩 폐기", "조정", "메모"])
        .gte("created_at", range.start)
        .lt("created_at", endRange.end)
        .order("created_at", { ascending: true }),
      DatabaseService.select("dashboard_todos", "*")
        .eq("store_id", storeId)
        .eq("is_completed", true)
        .is("deleted_at", null)
        .gte("completed_at", range.start)
        .lt("completed_at", endRange.end)
        .order("completed_at", { ascending: true }),
      DatabaseService.select("dashboard_todos", "*")
        .eq("store_id", storeId)
        .eq("is_completed", false)
        .is("deleted_at", null)
        .gte("task_date", rangeStartDate)
        .lte("task_date", rangeEndDate)
        .order("task_date", { ascending: true }),
      DatabaseService.select("group_order_events", "*")
        .eq("store_id", storeId)
        .gte("order_date", rangeStartDate)
        .lte("order_date", rangeEndDate)
        .order("order_date", { ascending: true })
        .order("requested_time", { ascending: true })
    ]);

    const firstError = logResult.error ?? completedTodoResult.error ?? plannedTodoResult.error ?? groupOrderResult.error;
    if (firstError) return { data: null, error: new Error(firstError.message) };

    const groupOrders = (groupOrderResult.data ?? []) as GroupOrderEvent[];
    const groupOrderIds = groupOrders.map((event) => event.id);
    const [groupOrderItemsResult, groupOrderMenusResult] = groupOrderIds.length > 0
      ? await Promise.all([
          DatabaseService.select("group_order_event_items", "*").eq("store_id", storeId).in("event_id", groupOrderIds),
          DatabaseService.select("group_order_menus", "id, name").eq("store_id", storeId)
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

    const groupOrderError = groupOrderItemsResult.error ?? groupOrderMenusResult.error;
    if (groupOrderError) return { data: null, error: new Error(groupOrderError.message) };

    const days = new Map<string, TimelineDay>();
    const logs = (logResult.data ?? []) as unknown as TimelineInventoryLog[];
    logs.forEach((log) => {
      const date = getSeoulDateValue(new Date(log.created_at));
      const productName = log.products?.name ?? "삭제된 상품";
      const base = { id: log.id, occurredAt: log.created_at, staffId: log.user_id };
      if (log.action === "입고") {
        addEvent(days, date, { ...base, type: "receipt", title: productName, detail: `${formatQuantity(log.quantity)}${formatLocation(log.destination_location)}` });
      } else if (log.action === "프랩 제조") {
        addEvent(days, date, { ...base, type: "prep-production", title: productName, detail: `제조 ${formatQuantity(log.quantity)}` });
      } else if (log.action === "프랩 폐기") {
        addEvent(days, date, { ...base, type: "prep-disposal", title: productName, detail: `폐기 ${formatQuantity(log.quantity)}` });
      } else if (log.action === "조정") {
        addEvent(days, date, { ...base, type: "inventory-adjustment", title: productName, detail: `${log.previous_quantity ?? 0} → ${log.new_quantity ?? 0}${formatLocation(log.source_location)}` });
      } else if (log.action === "메모") {
        addEvent(days, date, { ...base, type: "memo", title: log.note ?? "메모", detail: productName });
      }
    });

    ((completedTodoResult.data ?? []) as DashboardTodo[]).forEach((todo) => {
      if (!todo.completed_at) return;
      addEvent(days, getSeoulDateValue(new Date(todo.completed_at)), {
        id: todo.id,
        type: "todo-completed",
        occurredAt: todo.completed_at,
        title: todo.content,
        detail: "완료",
        staffId: todo.completed_by
      });
    });

    const todayValue = getSeoulDateValue();
    ((plannedTodoResult.data ?? []) as DashboardTodo[]).forEach((todo) => {
      if (todo.task_date < todayValue) return;
      addEvent(days, todo.task_date, {
        id: todo.id,
        type: "todo-planned",
        occurredAt: null,
        title: todo.content,
        detail: "예정",
        staffId: null
      });
    });

    const menuNames = new Map(((groupOrderMenusResult.data ?? []) as GroupOrderMenu[]).map((menu) => [menu.id, menu.name]));
    const itemsByEventId = new Map<string, GroupOrderEventItem[]>();
    ((groupOrderItemsResult.data ?? []) as GroupOrderEventItem[]).forEach((item) => {
      const current = itemsByEventId.get(item.event_id) ?? [];
      current.push(item);
      itemsByEventId.set(item.event_id, current);
    });
    groupOrders.forEach((order) => {
      const items = itemsByEventId.get(order.id) ?? [];
      const itemSummary = items.length > 0
        ? items.map((item) => `${menuNames.get(item.menu_id) ?? "메뉴"} ${item.quantity}개`).join(", ")
        : "메뉴 없음";
      addEvent(days, order.order_date, {
        id: order.id,
        type: "group-order",
        occurredAt: `${order.order_date}T${order.requested_time}+09:00`,
        title: order.organization_name,
        detail: `${itemSummary}${order.note ? ` · ${order.note}` : ""}`,
        staffId: null
      });
    });

    const staffNames = await resolveStaffNames(
      storeId,
      Array.from(days.values()).flatMap((day) => day.events.map((event) => event.staffId ?? ""))
    );
    return { data: { days, staffNames }, error: null };
  }
};
