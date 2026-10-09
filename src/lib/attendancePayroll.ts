export type PayrollShiftInput = {
  checkInAt: string;
  checkOutAt: string;
  unpaidBreakMinutes: number;
  hourlyWage: number;
  overtimeMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
};

export type PayrollSummary = {
  workedMinutes: number;
  basePay: number;
  overtimeAllowance: number;
  nightAllowance: number;
  holidayAllowance: number;
  weeklyAllowance: number;
  withoutAllowances: number;
  withAllowances: number;
  weeklyThresholdMinutes: number;
  roundingVersion: number;
};

export type RoundingRule = "half_up" | "floor" | "ceil";
type EffectiveDated = { effective_from: string; effective_to: string | null };

const ATTENDANCE_TOKEN_SESSION_KEY = "stockly-pending-attendance-token";
const ATTENDANCE_TOKEN_TTL_MS = 10 * 60 * 1000;
// A tag belongs to this running app only, even if WebView storage is restored.
const ATTENDANCE_TOKEN_RUNTIME_ID = crypto.randomUUID();

type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type AttendanceTimeSuggestion = {
  tagged_at: string;
  suggested_time?: string | null;
  scheduled_time?: string | null;
};

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("유효한 날짜와 시간을 입력해 주세요.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallTime = new Date(0);
  wallTime.setUTCFullYear(year, month - 1, day);
  wallTime.setUTCHours(hour, minute, 0, 0);
  if (wallTime.toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error("유효한 날짜와 시간을 입력해 주세요.");
  const guess = wallTime.getTime();
  const shown = zonedParts(new Date(guess), timeZone);
  const shownAsUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute), Number(shown.second));
  const result = new Date(guess - (shownAsUtc - guess));
  const resolved = zonedParts(result, timeZone);
  if (`${resolved.year}-${resolved.month}-${resolved.day}T${resolved.hour}:${resolved.minute}` !== `${date}T${time}`) {
    throw new Error("유효한 날짜와 시간을 입력해 주세요.");
  }
  return result;
}

export function parseAttendanceTagUrl(rawUrl: string, allowedHost = window.location.host, channel: "production" | "development" = "production") {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.host !== allowedHost || url.username || url.password || url.search || url.hash) return null;
    const path = channel === "development" ? url.pathname.replace(/^\/attendance\/dev\/tag\//, "/attendance/tag/") : url.pathname;
    const match = path.match(/^\/attendance\/tag\/([A-Za-z0-9_-]{3,256})\/?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function attendanceTagUrl(token: string, host: string, channel: "production" | "development" = "production") {
  const prefix = channel === "development" ? "/attendance/dev/tag/" : "/attendance/tag/";
  return new URL(`${prefix}${encodeURIComponent(token)}`, `https://${host}`).toString();
}

export function resolveEnteredDateTime(taggedAt: string, enteredDate: string, enteredTime: string, timeZone?: string, openCheckInAt?: string): string;
export function resolveEnteredDateTime(taggedAt: string, enteredTime: string, timeZone?: string, openCheckInAt?: string): string;
export function resolveEnteredDateTime(
  taggedAt: string,
  dateOrTime: string,
  timeOrZone = "Asia/Seoul",
  zoneOrOpenCheckIn?: string,
  openCheckInArg?: string
) {
  const tagged = new Date(taggedAt);
  if (Number.isNaN(tagged.getTime())) throw new Error("태그 시각이 올바르지 않습니다.");
  const explicitDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOrTime);
  const local = explicitDate ? null : zonedParts(tagged, timeOrZone);
  const enteredDate = explicitDate ? dateOrTime : `${local?.year}-${local?.month}-${local?.day}`;
  const enteredTime = explicitDate ? timeOrZone : dateOrTime;
  const timeZone = explicitDate ? zoneOrOpenCheckIn ?? "Asia/Seoul" : timeOrZone;
  const openCheckInAt = explicitDate ? openCheckInArg : zoneOrOpenCheckIn;
  const entered = zonedDateTimeToUtc(enteredDate, enteredTime, timeZone);
  if (openCheckInAt && Number.isNaN(new Date(openCheckInAt).getTime())) throw new Error("출근 시각이 올바르지 않습니다.");
  if (explicitDate && openCheckInAt && entered.getTime() <= new Date(openCheckInAt).getTime()) {
    throw new Error("퇴근 시각은 출근 시각보다 뒤여야 합니다.");
  }
  if (!explicitDate && openCheckInAt && entered.getTime() <= new Date(openCheckInAt).getTime()) {
    const nextDate = new Date(entered.getTime() + 24 * 60 * 60 * 1000);
    const nextLocal = zonedParts(nextDate, timeZone);
    return zonedDateTimeToUtc(`${nextLocal.year}-${nextLocal.month}-${nextLocal.day}`, enteredTime, timeZone).toISOString();
  }
  return entered.toISOString();
}

export function differenceInMinutes(left: string, right: string) {
  return Math.round((new Date(right).getTime() - new Date(left).getTime()) / 60000);
}

export function signedMinutesLabel(minutes: number) {
  return `${minutes > 0 ? "+" : ""}${minutes}분`;
}

export function defaultAttendanceDate(punch: AttendanceTimeSuggestion) {
  const parts = zonedParts(new Date(punch.tagged_at), "Asia/Seoul");
  const roundedPastMidnight = !punch.scheduled_time && Number(parts.hour) === 23 && Number(parts.minute) >= 30;
  const date = new Date(0);
  date.setUTCFullYear(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  if (roundedPastMidnight) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function defaultAttendanceTime(punch: AttendanceTimeSuggestion) {
  const scheduled = punch.scheduled_time;
  if (scheduled && /^([01]\d|2[0-3]):[0-5]\d$/.test(scheduled)) return scheduled;
  const parts = zonedParts(new Date(punch.tagged_at), "Asia/Seoul");
  let hour = Number(parts.hour);
  if (Number(parts.minute) >= 30) hour = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00`;
}

export function savePendingAttendanceToken(storage: TokenStorage, token: string, now = Date.now()) {
  const existing = readPendingAttendanceEntry(storage, now);
  storage.setItem(ATTENDANCE_TOKEN_SESSION_KEY, JSON.stringify({
    token,
    runtimeId: ATTENDANCE_TOKEN_RUNTIME_ID,
    savedAt: now,
    requestId: existing?.token === token ? existing.requestId : crypto.randomUUID()
  }));
  return token;
}

function readPendingAttendanceEntry(storage: TokenStorage, now = Date.now()) {
  const raw = storage.getItem(ATTENDANCE_TOKEN_SESSION_KEY);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as { token?: unknown; savedAt?: unknown; requestId?: unknown; runtimeId?: unknown };
    if (entry.runtimeId !== ATTENDANCE_TOKEN_RUNTIME_ID || now < (entry.savedAt as number) || typeof entry.token !== "string" || !entry.token || typeof entry.savedAt !== "number" || typeof entry.requestId !== "string" || now - entry.savedAt > ATTENDANCE_TOKEN_TTL_MS) {
      storage.removeItem(ATTENDANCE_TOKEN_SESSION_KEY);
      return null;
    }
    return { token: entry.token, savedAt: entry.savedAt, requestId: entry.requestId };
  } catch {
    storage.removeItem(ATTENDANCE_TOKEN_SESSION_KEY);
    return null;
  }
}

export function readPendingAttendanceToken(storage: TokenStorage, now = Date.now()) {
  return readPendingAttendanceEntry(storage, now)?.token ?? null;
}

export function pendingAttendanceRequestId(storage: TokenStorage, now = Date.now()) {
  return readPendingAttendanceEntry(storage, now)?.requestId ?? null;
}

export function consumePendingAttendanceToken(storage: TokenStorage, now = Date.now()) {
  const token = readPendingAttendanceToken(storage, now);
  storage.removeItem(ATTENDANCE_TOKEN_SESSION_KEY);
  return token;
}

export function resolveEffectiveDated<T extends EffectiveDated>(history: T[], timestamp: string, timeZone = "Asia/Seoul") {
  const parts = zonedParts(new Date(timestamp), timeZone);
  const workDate = `${parts.year}-${parts.month}-${parts.day}`;
  return history
    .filter((item) => item.effective_from <= workDate && (!item.effective_to || item.effective_to >= workDate))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
}

export function calculatePayrollSummary(input: {
  shifts: PayrollShiftInput[];
  weeklyAllowance?: number;
  overtimeMultiplier?: number;
  nightMultiplier?: number;
  holidayMultiplier?: number;
  weeklyThresholdMinutes?: number;
  roundingRule?: RoundingRule;
  roundingVersion?: number;
}): PayrollSummary {
  const totals = input.shifts.reduce(
    (result, shift) => {
      const duration = Math.max(0, differenceInMinutes(shift.checkInAt, shift.checkOutAt) - Math.max(0, shift.unpaidBreakMinutes));
      const perMinute = Math.max(0, shift.hourlyWage) / 60;
      result.workedMinutes += duration;
      result.basePay += duration * perMinute;
      result.overtimeAllowance += Math.max(0, shift.overtimeMinutes) * perMinute * (input.overtimeMultiplier ?? 0.5);
      result.nightAllowance += Math.max(0, shift.nightMinutes) * perMinute * (input.nightMultiplier ?? 0.5);
      result.holidayAllowance += Math.max(0, shift.holidayMinutes) * perMinute * (input.holidayMultiplier ?? 0.5);
      return result;
    },
    { workedMinutes: 0, basePay: 0, overtimeAllowance: 0, nightAllowance: 0, holidayAllowance: 0 }
  );
  const weeklyAllowance = Math.max(0, input.weeklyAllowance ?? 0);
  const round = input.roundingRule === "floor" ? Math.floor : input.roundingRule === "ceil" ? Math.ceil : (value: number) => Math.floor(value + 0.5);
  const rounded = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value)])) as typeof totals;
  const roundedWeeklyAllowance = round(weeklyAllowance);
  return {
    ...rounded,
    weeklyAllowance: roundedWeeklyAllowance,
    withoutAllowances: rounded.basePay,
    withAllowances: rounded.basePay + rounded.overtimeAllowance + rounded.nightAllowance + rounded.holidayAllowance + roundedWeeklyAllowance,
    weeklyThresholdMinutes: Math.max(0, input.weeklyThresholdMinutes ?? 900),
    roundingVersion: input.roundingVersion ?? 1
  };
}
