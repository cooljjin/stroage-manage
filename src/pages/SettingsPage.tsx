import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Link2, LogOut, MessageCircle, Moon, Plus, Search, Sun, Trash2, Unlink, UserRound } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { getSeoulDateValue, WEEKDAYS } from "../lib/businessCalendar";
import * as Services from "../services";
import type { UserIdentity } from "../services";
import type { ProfileRole, StoreClosureDate, WeeklyStoreClosure } from "../types/domain";

const APP_VERSION = "1.0.1";
type LinkProvider = "google" | "kakao";

const LINK_PROVIDERS: Array<{
  provider: LinkProvider;
  label: string;
  buttonLabel: string;
  Icon: typeof Search;
  className: string;
}> = [
  {
    provider: "google",
    label: "Google",
    buttonLabel: "Google 계정 연동",
    Icon: Search,
    className: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
  },
  {
    provider: "kakao",
    label: "카카오",
    buttonLabel: "카카오 계정 연동",
    Icon: MessageCircle,
    className: "border-[#FEE500] bg-[#FEE500] text-[#191919] hover:bg-[#f5dc00]"
  }
];

function closureDateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${value}T00:00:00`));
}

function identityEmail(identity: UserIdentity) {
  const email = identity.identity_data?.email;
  return typeof email === "string" ? email : "";
}

function identityName(identity: UserIdentity) {
  const fullName = identity.identity_data?.full_name;
  const name = identity.identity_data?.name;
  const nickname = identity.identity_data?.nickname;
  if (typeof fullName === "string" && fullName.trim()) return fullName;
  if (typeof name === "string" && name.trim()) return name;
  if (typeof nickname === "string" && nickname.trim()) return nickname;
  return "";
}

function authErrorMessage(message: string) {
  if (message.includes("manual_linking_disabled") || message.includes("linking")) {
    return "Supabase Auth 설정에서 Manual Linking을 켜야 계정 연동/해제가 가능합니다.";
  }
  if (message.includes("already")) {
    return "이미 다른 계정에 연결된 소셜 계정이거나 현재 계정에 연결된 계정입니다.";
  }
  return message;
}

type Props = {
  currentRole: ProfileRole;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
};

export function SettingsPage({ currentRole, darkMode, onToggleDarkMode, onLogout }: Props) {
  const todayValue = useMemo(() => getSeoulDateValue(), []);
  const canManageStoreClosures = currentRole !== "staff";
  const [weeklyClosures, setWeeklyClosures] = useState<WeeklyStoreClosure[]>([]);
  const [specificClosures, setSpecificClosures] = useState<StoreClosureDate[]>([]);
  const [closureDate, setClosureDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(canManageStoreClosures);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const closedWeekdays = useMemo(() => new Set(weeklyClosures.map((item) => item.weekday)), [weeklyClosures]);
  const linkedIdentitiesByProvider = useMemo(() => {
    const entries = LINK_PROVIDERS.map((item) => [item.provider, identities.find((identity) => identity.provider === item.provider)] as const);
    return new Map(entries);
  }, [identities]);
  const emailIdentity = useMemo(() => identities.find((identity) => identity.provider === "email"), [identities]);

  const loadClosures = useCallback(async () => {
    if (!canManageStoreClosures) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const [weeklyResult, specificResult] = await Promise.all([
      Services.DatabaseService.select("weekly_store_closures", "*").order("weekday", { ascending: true }),
      Services.DatabaseService.select("store_closure_dates", "*").gte("closure_date", todayValue).order("closure_date", { ascending: true })
    ]);

    const loadError = weeklyResult.error ?? specificResult.error;
    if (loadError) {
      setError(
        loadError.message.includes("weekly_store_closures") || loadError.message.includes("store_closure_dates")
          ? "휴무일용 데이터베이스 업데이트가 필요합니다."
          : loadError.message
      );
    } else {
      setWeeklyClosures((weeklyResult.data ?? []) as WeeklyStoreClosure[]);
      setSpecificClosures((specificResult.data ?? []) as StoreClosureDate[]);
    }
    setLoading(false);
  }, [canManageStoreClosures, todayValue]);

  useEffect(() => {
    void loadClosures();
  }, [loadClosures]);

  const loadAccountIdentities = useCallback(async () => {
    setAccountLoading(true);
    setAccountError("");

    const [userResult, identitiesResult] = await Promise.all([
      Services.AuthService.getUser(),
      Services.AuthService.getUserIdentities()
    ]);

    const loadError = userResult.error ?? identitiesResult.error;
    if (loadError) {
      setAccountError(authErrorMessage(loadError.message));
    } else {
      setCurrentUserEmail(userResult.data.user?.email ?? "");
      setIdentities(identitiesResult.data?.identities ?? []);
    }

    setAccountLoading(false);
  }, []);

  useEffect(() => {
    void loadAccountIdentities();
  }, [loadAccountIdentities]);

  async function linkProvider(provider: LinkProvider) {
    setSavingKey(`link-${provider}`);
    setError("");
    setMessage("");

    const { error: linkError } = await Services.AuthService.linkOAuthIdentity(provider);
    if (linkError) {
      localStorage.removeItem(Services.ACCOUNT_LINK_RETURN_STORAGE_KEY);
      setError(authErrorMessage(linkError.message));
      setSavingKey(null);
      return;
    }

    setMessage("소셜 계정 인증 화면으로 이동합니다.");
    setSavingKey(null);
  }

  async function unlinkProvider(provider: LinkProvider) {
    const identity = linkedIdentitiesByProvider.get(provider);
    const providerLabel = LINK_PROVIDERS.find((item) => item.provider === provider)?.label ?? provider;
    if (!identity) return;
    if (!window.confirm(`${providerLabel} 계정 연동을 해제할까요?`)) return;

    if (identities.length < 2) {
      setError("로그인 수단이 하나만 남아 있어 연동을 해제할 수 없습니다.");
      return;
    }

    setSavingKey(`unlink-${provider}`);
    setError("");
    setMessage("");

    const { error: unlinkError } = await Services.AuthService.unlinkIdentity(identity);
    if (unlinkError) {
      setError(authErrorMessage(unlinkError.message));
    } else {
      setMessage(`${providerLabel} 계정 연동을 해제했습니다.`);
      await loadAccountIdentities();
    }

    setSavingKey(null);
  }

  async function toggleWeeklyClosure(weekday: number) {
    setSavingKey(`weekday-${weekday}`);
    setError("");
    setMessage("");

    if (closedWeekdays.has(weekday)) {
      const { error: deleteError } = await Services.DatabaseService.delete("weekly_store_closures").eq("weekday", weekday);
      if (deleteError) {
        setError(deleteError.message);
      } else {
        setMessage(`${WEEKDAYS[weekday].label} 정기 휴무를 해제했습니다.`);
        await loadClosures();
      }
    } else {
      if (closedWeekdays.size >= 6) {
        setError("최소 한 요일은 영업일로 남겨야 합니다.");
        setSavingKey(null);
        return;
      }
      const { data: userData } = await Services.AuthService.getUser();
      if (!userData.user) {
        setError("로그인이 필요합니다.");
      } else {
        const { error: insertError } = await Services.DatabaseService.insert("weekly_store_closures", {
          weekday,
          created_by: userData.user.id
        });
        if (insertError) {
          setError(insertError.message);
        } else {
          setMessage(`${WEEKDAYS[weekday].label}을 정기 휴무로 지정했습니다.`);
          await loadClosures();
        }
      }
    }

    setSavingKey(null);
  }

  async function addSpecificClosure(event: FormEvent) {
    event.preventDefault();
    if (!closureDate) return;

    setSavingKey("specific");
    setError("");
    setMessage("");
    const { data: userData } = await Services.AuthService.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSavingKey(null);
      return;
    }

    const { error: insertError } = await Services.DatabaseService.insert("store_closure_dates", {
      closure_date: closureDate,
      reason: reason.trim() || null,
      created_by: userData.user.id
    });

    if (insertError) {
      setError(insertError.code === "23505" ? "이미 휴무일로 지정된 날짜입니다." : insertError.message);
    } else {
      setClosureDate("");
      setReason("");
      setMessage("특정 휴무일을 추가했습니다.");
      await loadClosures();
    }
    setSavingKey(null);
  }

  async function deleteSpecificClosure(item: StoreClosureDate) {
    if (!window.confirm(`${closureDateLabel(item.closure_date)} 휴무를 삭제할까요?`)) return;

    setSavingKey(`date-${item.closure_date}`);
    setError("");
    setMessage("");
    const { error: deleteError } = await Services.DatabaseService.delete("store_closure_dates").eq("closure_date", item.closure_date);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage("특정 휴무일을 삭제했습니다.");
      await loadClosures();
    }
    setSavingKey(null);
  }

  return (
    <section>
      <PageTitle title="환경설정" description="매장 운영에 필요한 설정을 관리합니다." />

      {loading ? <StatusMessage>환경설정을 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 dark:border-slate-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100">
                {darkMode ? <Moon size={21} /> : <Sun size={21} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-extrabold">앱 설정</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">화면 모드를 관리합니다.</p>
              </div>
              <ChevronRight className="text-slate-400" size={18} />
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-extrabold">다크모드</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{darkMode ? "어두운 화면을 사용 중입니다." : "밝은 화면을 사용 중입니다."}</p>
                </div>
                <button
                  type="button"
                  onClick={onToggleDarkMode}
                  aria-pressed={darkMode}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${darkMode ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700"}`}
                >
                  <span className={`absolute top-1 grid h-6 w-6 place-items-center rounded-full bg-white text-slate-700 shadow-sm transition-transform ${darkMode ? "translate-x-7" : "translate-x-1"}`}>
                    {darkMode ? <Moon size={14} /> : <Sun size={14} />}
                  </span>
                  <span className="sr-only">다크모드 전환</span>
                </button>
              </div>

            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 dark:border-slate-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <UserRound size={21} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-extrabold">로그인 계정 연동</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">이메일 로그인 계정에 다른 이메일의 Google 또는 카카오 로그인을 연결합니다.</p>
              </div>
              <ChevronRight className="text-slate-400" size={18} />
            </div>

            <div className="space-y-4 p-4">
              {accountLoading ? <StatusMessage>계정 연동 상태를 불러오는 중...</StatusMessage> : null}
              {accountError ? <StatusMessage type="error">{accountError}</StatusMessage> : null}

              {!accountLoading && !accountError ? (
                <>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                    <p className="font-bold">기본 로그인 이메일</p>
                    <p className="mt-1 truncate text-slate-600 dark:text-slate-300">{currentUserEmail || (emailIdentity ? identityEmail(emailIdentity) : "") || "확인되지 않음"}</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {LINK_PROVIDERS.map((item) => {
                      const linkedIdentity = linkedIdentitiesByProvider.get(item.provider);
                      const Icon = item.Icon;
                      const linkedEmail = linkedIdentity ? identityEmail(linkedIdentity) : "";
                      const linkedName = linkedIdentity ? identityName(linkedIdentity) : "";
                      const isBusy = savingKey === `link-${item.provider}` || savingKey === `unlink-${item.provider}`;
                      return (
                        <div key={item.provider} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                          <div className="mb-3 flex items-start gap-3">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-100">
                              <Icon size={20} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-extrabold">{item.label}</p>
                              {linkedIdentity ? (
                                <>
                                  <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">연동됨</p>
                                  <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{linkedName || linkedEmail || "계정 정보 확인됨"}</p>
                                </>
                              ) : (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">아직 연동되지 않았습니다.</p>
                              )}
                            </div>
                          </div>

                          {linkedIdentity ? (
                            <button
                              type="button"
                              disabled={savingKey !== null}
                              onClick={() => void unlinkProvider(item.provider)}
                              className="touch-button inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950"
                            >
                              <Unlink size={17} />
                              {isBusy ? "해제 중..." : "연동 해제"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={savingKey !== null}
                              onClick={() => void linkProvider(item.provider)}
                              className={`touch-button inline-flex w-full items-center justify-center gap-2 rounded-md border px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${item.className}`}
                            >
                              <Link2 size={17} />
                              {isBusy ? "이동 중..." : item.buttonLabel}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {canManageStoreClosures ? (
            <div className="panel overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 dark:border-slate-800">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100">
                  <CalendarDays size={21} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-extrabold">매장 휴무일 지정</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">기존 미래 할 일과 인수인계도 다음 영업일로 자동 이동합니다.</p>
                </div>
                <ChevronRight className="text-slate-400" size={18} />
              </div>

              <div className="space-y-6 p-4">
                <div>
                  <h3 className="text-sm font-extrabold">매주 반복 휴무</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">매주 쉬는 요일을 모두 선택하세요.</p>
                  <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {WEEKDAYS.map((day) => {
                      const selected = closedWeekdays.has(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          disabled={savingKey !== null}
                          onClick={() => void toggleWeeklyClosure(day.value)}
                          aria-pressed={selected}
                          className={`min-h-12 rounded-md border text-sm font-extrabold disabled:opacity-50 ${
                            selected
                              ? "border-brand-600 bg-brand-600 text-white"
                              : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          }`}
                        >
                          {day.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                  <h3 className="text-sm font-extrabold">특정 날짜 휴무</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">공휴일이나 매장 사정으로 쉬는 날짜를 추가하세요.</p>

                  <form onSubmit={addSpecificClosure} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,180px)_1fr_auto]">
                    <input
                      type="date"
                      className="field"
                      min={todayValue}
                      value={closureDate}
                      onChange={(event) => setClosureDate(event.target.value)}
                      aria-label="휴무 날짜"
                    />
                    <input
                      className="field"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="사유 (선택)"
                    />
                    <button
                      type="submit"
                      disabled={!closureDate || savingKey !== null}
                      className="primary-button inline-flex items-center justify-center gap-2 sm:min-w-24"
                    >
                      <Plus size={18} />
                      추가
                    </button>
                  </form>

                  <div className="mt-4 space-y-2">
                    {specificClosures.map((item) => (
                      <div key={item.closure_date} className="flex items-center gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold">{closureDateLabel(item.closure_date)}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.reason || "사유 없음"}</p>
                        </div>
                        <button
                          type="button"
                          disabled={savingKey !== null}
                          onClick={() => void deleteSpecificClosure(item)}
                          className="touch-button grid shrink-0 place-items-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                          aria-label={`${closureDateLabel(item.closure_date)} 휴무 삭제`}
                          title="삭제"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                    {specificClosures.length === 0 ? <StatusMessage>등록된 특정 휴무일이 없습니다.</StatusMessage> : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onLogout}
            className="touch-button inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950"
          >
            <LogOut size={17} />
            로그아웃
          </button>

          <div className="pb-2 text-center text-xs font-semibold text-slate-400 dark:text-slate-500">
            버전 {APP_VERSION}
          </div>
        </div>
      ) : null}
    </section>
  );
}
