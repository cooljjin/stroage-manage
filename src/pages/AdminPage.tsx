import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import * as Services from "../services";
import type { StaffProfile } from "../types/domain";

export function AdminPage() {
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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

  return (
    <section>
      <PageTitle title="관리자 페이지" description="직원 이름을 관리합니다." />

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
                <th className="w-16 px-3 py-3 text-right">저장</th>
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
                    <span className={`rounded px-2 py-1 text-xs font-bold ${profile.is_admin ? "bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                      {profile.is_admin ? "관리자" : "직원"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => saveName(profile)}
                      className="touch-button inline-flex items-center justify-center rounded-md border border-slate-300 px-2 dark:border-slate-700"
                      aria-label="직원 이름 저장"
                      title="저장"
                    >
                      <Save size={18} />
                    </button>
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
