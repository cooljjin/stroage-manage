import { FormEvent, useEffect, useMemo, useState } from "react";
import { Copy, Save, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import * as Services from "../services";
import type { ProfileRole, StaffProfile, StoreInvite } from "../types/domain";

const ROLE_LABEL: Record<ProfileRole, string> = {
  master: "마스터",
  store_admin: "관리자",
  staff: "직원"
};

function getProfileRole(profile: StaffProfile): ProfileRole {
  return profile.role ?? (profile.is_admin ? "store_admin" : "staff");
}

function formatDeleteUserError(message: string | undefined) {
  if (!message) return "직원 삭제에 실패했습니다.";
  if (message.includes("Failed to send a request")) {
    return "직원 삭제용 Edge Function이 배포되지 않았거나 접근할 수 없습니다. delete-auth-user 함수를 배포해 주세요.";
  }
  return message;
}

export function StaffManagementPage() {
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [inviteRole, setInviteRole] = useState<Exclude<ProfileRole, "master">>("staff");
  const [createdInvite, setCreatedInvite] = useState<StoreInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const inviteCode = useMemo(() => {
    if (!createdInvite) return "";
    return createdInvite.token;
  }, [createdInvite]);

  useEffect(() => {
    void loadProfiles();
  }, []);

  async function loadProfiles() {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await Services.DatabaseService.select("profiles", "*").order("created_at", { ascending: true });

    if (loadError) {
      setError(loadError.message);
    } else {
      const nextProfiles = (data ?? []) as StaffProfile[];
      setProfiles(nextProfiles);
      setDraftNames(Object.fromEntries(nextProfiles.map((profile) => [profile.id, profile.display_name])));
    }

    setLoading(false);
  }

  async function saveName(profile: StaffProfile) {
    const displayName = draftNames[profile.id]?.trim();
    if (!displayName) {
      setError("직원 이름은 비워둘 수 없습니다.");
      return;
    }

    setError("");
    setMessage("");
    const { error: updateError } = await Services.DatabaseService.update("profiles", { display_name: displayName, updated_at: new Date().toISOString() })
      .eq("id", profile.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage("직원 이름을 저장했습니다.");
      await loadProfiles();
    }
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setCreatedInvite(null);

    const { data, error: inviteError } = await Services.DatabaseService.rpc("create_store_invite", {
      target_role: inviteRole
    });

    if (inviteError) {
      setError(inviteError.message);
      return;
    }

    setCreatedInvite(data as StoreInvite);
    setMessage("초대코드를 생성했습니다.");
  }

  async function copyInviteCode() {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setMessage("초대코드를 복사했습니다.");
  }

  async function deleteProfile(profile: StaffProfile) {
    if (getProfileRole(profile) !== "staff") {
      setError("관리자는 직원 계정만 삭제할 수 있습니다.");
      return;
    }

    const label = profile.email ?? profile.display_name;
    if (!window.confirm(`${label} 직원을 완전히 삭제할까요?\n삭제하면 다시 같은 이메일로 회원가입할 수 있습니다.`)) {
      return;
    }

    setError("");
    setMessage("");

    const { data, error: deleteError } = await Services.EdgeFunctionService.invoke<{ ok?: boolean; error?: string }>("delete-auth-user", {
      body: { userId: profile.id }
    });

    if (deleteError || data?.error) {
      setError(formatDeleteUserError(data?.error ?? deleteError?.message));
    } else {
      setMessage("직원을 완전히 삭제했습니다.");
      await loadProfiles();
    }
  }

  return (
    <section>
      <PageTitle title="직원 관리" description="직원 이름을 관리하고 초대코드를 생성합니다." />

      <form onSubmit={createInvite} className="panel mb-4 grid gap-3 p-4 sm:grid-cols-[150px_auto]">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">권한</span>
          <select className="field" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<ProfileRole, "master">)}>
            <option value="staff">직원</option>
            <option value="store_admin">관리자</option>
          </select>
        </label>
        <button type="submit" className="primary-button self-end">
          초대코드 생성
        </button>
      </form>

      {inviteCode ? (
        <div className="panel mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <input className="field flex-1 text-center text-lg font-bold uppercase tracking-widest" value={inviteCode} readOnly />
          <button type="button" onClick={copyInviteCode} className="secondary-button inline-flex items-center justify-center gap-2">
            <Copy size={18} />
            복사
          </button>
        </div>
      ) : null}

      {loading ? <StatusMessage>직원 목록을 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="panel overflow-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="px-3 py-3">계정</th>
                <th className="px-3 py-3">직원 이름</th>
                <th className="w-20 px-3 py-3">권한</th>
                <th className="w-24 px-3 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="px-3 py-3">
                    <span className="block truncate font-semibold">{profile.email ?? "이메일 없음"}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{profile.id}</span>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      className="field min-h-11 py-2"
                      value={draftNames[profile.id] ?? ""}
                      onChange={(event) => setDraftNames((value) => ({ ...value, [profile.id]: event.target.value }))}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded bg-slate-200 px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {ROLE_LABEL[getProfileRole(profile)]}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => saveName(profile)}
                        className="touch-button inline-flex items-center justify-center rounded-md border border-slate-300 px-2 dark:border-slate-700"
                        aria-label="직원 이름 저장"
                        title="저장"
                      >
                        <Save size={18} />
                      </button>
                      {getProfileRole(profile) === "staff" ? (
                        <button
                          type="button"
                          onClick={() => deleteProfile(profile)}
                          className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-2 text-red-600 dark:border-red-900 dark:text-red-300"
                          aria-label="직원 삭제"
                          title="삭제"
                        >
                          <Trash2 size={18} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {profiles.length === 0 ? <div className="p-4"><StatusMessage>등록된 직원 프로필이 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}
    </section>
  );
}
