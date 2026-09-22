import { useMemo, useState } from "react";
import { Clock3, Nfc } from "lucide-react";
import { defaultAttendanceTime, differenceInMinutes, resolveEnteredDateTime, signedMinutesLabel } from "../lib/attendancePayroll";
import type { AttendancePunchPromptData } from "../types/domain";

function seoulTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
}


type Props = {
  punch: AttendancePunchPromptData;
  saving: boolean;
  error: string;
  onConfirm: (enteredTime: string) => void;
};

export function AttendancePunchPrompt({ punch, saving, error, onConfirm }: Props) {
  const [enteredTime, setEnteredTime] = useState(() => defaultAttendanceTime(punch));
  const enteredAt = useMemo(
    () => resolveEnteredDateTime(punch.tagged_at, enteredTime, "Asia/Seoul", punch.open_check_in_at ?? undefined),
    [enteredTime, punch.open_check_in_at, punch.tagged_at]
  );
  const difference = differenceInMinutes(punch.tagged_at, enteredAt);
  const label = punch.punch_type === "check_in" ? "출근" : "퇴근";

  return (
    <div className="fixed inset-0 z-[100] grid place-items-end bg-slate-950/55 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="attendance-punch-title">
      <div className="w-full rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-slate-950 sm:max-w-md sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-200"><Nfc size={22} /></span>
          <div>
            <h2 id="attendance-punch-title" className="text-xl font-bold">{label} 시간 입력</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{punch.tag_name} NFC 태그를 인식했습니다.</p>
          </div>
        </div>

        <div className="mb-4 grid gap-2 rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">
          <p className="flex items-center justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">실제 태그 시각</span><strong>{seoulTime(punch.tagged_at)}</strong></p>
          <p className="flex items-center justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">급여 반영 시각</span><strong>{seoulTime(enteredAt)}</strong></p>
          {difference !== 0 ? <p className="text-right text-xs font-semibold text-amber-700 dark:text-amber-300">실제 태그 대비 {signedMinutesLabel(difference)}</p> : null}
        </div>

        {punch.warning_message ? <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-100" role="alert">{punch.warning_message}</p> : null}

        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-sm font-bold"><Clock3 size={17} />몇 시로 기록할까요?</span>
          <input type="time" className="field min-h-14 w-full text-center text-xl font-bold" value={enteredTime} onChange={(event) => setEnteredTime(event.target.value)} disabled={saving} required />
        </label>
        {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-950 dark:text-red-100" role="alert">{error}</p> : null}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">실제 태그 시각은 별도로 보존되며 관리자만 확인할 수 있습니다.</p>
        <button type="button" className="primary-button mt-4 min-h-14 w-full text-base" disabled={saving || !enteredTime} onClick={() => onConfirm(enteredTime)}>
          {saving ? "저장 중..." : `${label} 기록 저장`}
        </button>
      </div>
    </div>
  );
}
