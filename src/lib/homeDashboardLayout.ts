export const DEFAULT_HOME_DASHBOARD_CARD_ORDER = ["receipts", "todos", "handovers"] as const;

export type HomeDashboardCardId = (typeof DEFAULT_HOME_DASHBOARD_CARD_ORDER)[number];

export function isHomeDashboardCardId(value: unknown): value is HomeDashboardCardId {
  return typeof value === "string" && (DEFAULT_HOME_DASHBOARD_CARD_ORDER as readonly string[]).includes(value);
}

export function normalizeHomeDashboardCardOrder(value: unknown): HomeDashboardCardId[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_HOME_DASHBOARD_CARD_ORDER.length) {
    return [...DEFAULT_HOME_DASHBOARD_CARD_ORDER];
  }

  const order: HomeDashboardCardId[] = [];
  value.forEach((item) => {
    if (isHomeDashboardCardId(item) && !order.includes(item)) order.push(item);
  });
  return order.length === DEFAULT_HOME_DASHBOARD_CARD_ORDER.length
    ? order
    : [...DEFAULT_HOME_DASHBOARD_CARD_ORDER];
}

export function moveHomeDashboardCard(
  order: HomeDashboardCardId[],
  dragged: HomeDashboardCardId,
  target: HomeDashboardCardId
): HomeDashboardCardId[] {
  const fromIndex = order.indexOf(dragged);
  const targetIndex = order.indexOf(target);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return order;

  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, dragged);
  return next;
}

export function moveHomeDashboardCardBy(
  order: HomeDashboardCardId[],
  card: HomeDashboardCardId,
  offset: number
): HomeDashboardCardId[] {
  const fromIndex = order.indexOf(card);
  const targetIndex = Math.max(0, Math.min(order.length - 1, fromIndex + Math.sign(offset)));
  const target = order[targetIndex];
  return fromIndex < 0 || !target ? order : moveHomeDashboardCard(order, card, target);
}

export function homeDashboardLayoutStorageKey(storeId: string, userId: string) {
  return `stockly-home-layout:${storeId}:${userId}`;
}
