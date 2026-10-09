export const WORK_TIME_ROW_HEIGHT = 44;
export const WORK_TIME_WHEEL_CYCLES = 19;
export const WORK_TIME_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
export const WORK_TIME_MINUTES = ["00", "30"];

export function wheelRow(scrollTop: number, optionCount: number) {
  return Math.max(0, Math.min(optionCount * WORK_TIME_WHEEL_CYCLES - 1, Math.round(scrollTop / WORK_TIME_ROW_HEIGHT)));
}

export function wheelValue(scrollTop: number, options: readonly string[]) {
  return options[wheelRow(scrollTop, options.length) % options.length];
}

export function centeredWheelRow(value: string, options: readonly string[]) {
  return Math.floor(WORK_TIME_WHEEL_CYCLES / 2) * options.length + Math.max(0, options.indexOf(value));
}

export function nearestWheelRow(scrollTop: number, value: string, options: readonly string[]) {
  const row = wheelRow(scrollTop, options.length);
  const index = Math.max(0, options.indexOf(value));
  const cycle = Math.floor(row / options.length);
  return [cycle - 1, cycle, cycle + 1]
    .map((candidate) => candidate * options.length + index)
    .filter((candidate) => candidate >= 0 && candidate < options.length * WORK_TIME_WHEEL_CYCLES)
    .sort((a, b) => Math.abs(a - row) - Math.abs(b - row))[0];
}

export function formatWorkTime(value: string) {
  const [hour, minute] = value.split(":");
  return `${Number(hour) >= 12 ? "오후" : "오전"} ${Number(hour) % 12 || 12}:${minute ?? "00"}`;
}
