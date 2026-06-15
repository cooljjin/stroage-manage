const SEOUL_TIME_ZONE = "Asia/Seoul";
const MAX_BUSINESS_DAY_SEARCH = 366;

export const WEEKDAYS = [
  { value: 0, label: "일요일", shortLabel: "일" },
  { value: 1, label: "월요일", shortLabel: "월" },
  { value: 2, label: "화요일", shortLabel: "화" },
  { value: 3, label: "수요일", shortLabel: "수" },
  { value: 4, label: "목요일", shortLabel: "목" },
  { value: 5, label: "금요일", shortLabel: "금" },
  { value: 6, label: "토요일", shortLabel: "토" }
] as const;

export function getSeoulDateValue(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDateValueDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getDateValueWeekday(value: string): number {
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

export function getNextBusinessDate(
  fromDate: string,
  weeklyClosureDays: ReadonlySet<number>,
  specificClosureDates: ReadonlySet<string>
): string {
  for (let daysAhead = 1; daysAhead <= MAX_BUSINESS_DAY_SEARCH; daysAhead += 1) {
    const candidate = addDateValueDays(fromDate, daysAhead);
    if (!weeklyClosureDays.has(getDateValueWeekday(candidate)) && !specificClosureDates.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("다음 영업일을 계산할 수 없습니다. 휴무일 설정을 확인해 주세요.");
}
