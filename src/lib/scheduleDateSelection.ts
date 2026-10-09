export type ScheduleDragMode = "select" | "deselect";

const DAY_MS = 86_400_000;

export function toggleScheduleDate(initialSelection: readonly string[], date: string) {
  const selected = new Set(initialSelection);
  if (selected.has(date)) selected.delete(date);
  else selected.add(date);
  return [...selected].sort();
}

function datesBetween(start: string, current: string) {
  const first = start < current ? start : current;
  const last = start < current ? current : start;
  const lastTime = Date.parse(`${last}T00:00:00.000Z`);
  const dates: string[] = [];

  for (let time = Date.parse(`${first}T00:00:00.000Z`); time <= lastTime; time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }

  return dates;
}

export function applyScheduleDateRange(
  initialSelection: readonly string[],
  start: string,
  current: string,
  mode: ScheduleDragMode
) {
  const selected = new Set(initialSelection);
  for (const date of datesBetween(start, current)) {
    if (mode === "select") selected.add(date);
    else selected.delete(date);
  }
  return [...selected].sort();
}

export function hasExceededScheduleDragThreshold(startX: number, startY: number, currentX: number, currentY: number) {
  return Math.hypot(currentX - startX, currentY - startY) > 8;
}

export function calendarDateAtPoint(calendar: HTMLElement, clientX: number, clientY: number) {
  const target = document.elementFromPoint(clientX, clientY);
  const cell = target?.closest<HTMLButtonElement>("button[data-calendar-date]");
  if (cell && calendar.contains(cell)) return cell.dataset.calendarDate ?? null;
  if (target && target !== calendar && calendar.contains(target)) return null;

  const bounds = calendar.getBoundingClientRect();
  if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;

  let nearestDate: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  calendar.querySelectorAll<HTMLButtonElement>("button[data-calendar-date]").forEach((dateCell) => {
    const rect = dateCell.getBoundingClientRect();
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDate = dateCell.dataset.calendarDate ?? null;
      nearestDistance = distance;
    }
  });
  return nearestDate;
}
