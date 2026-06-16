import { useEffect, useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { supabase } from "../lib/supabase";
import type { ProfileRole, StaffProfile, Store } from "../types/domain";

const ROLE_LABEL: Record<ProfileRole, string> = {
  master: "마스터",
  store_admin: "관리자",
  staff: "직원"
};

function roleOf(profile: StaffProfile): ProfileRole {
  return profile.role ?? (profile.is_admin ? "store_admin" : "staff");
}

export function MasterUsersPage() {
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const storeNameById = useMemo(() => {
    return new Map(stores.map((store) => [store.id, store.name]));
  }, [stores]);

  const groupedProfiles = useMemo(() => {
    return profiles.reduce<Record<string, StaffProfile[]>>((groups, profile) => {
      const storeName = storeNameById.get(profile.store_id) ?? "매장 미지정";
      groups[storeName] = groups[storeName] ?? [];
      groups[storeName].push(profile);
      return groups;
    }, {});
  }, [profiles, storeNameById]);

  useEffect(() => {
    void loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    setError("");

    const [storesResult, profilesResult] = await Promise.all([
      supabase.from("stores").select("*").order("name", { ascending: true }),
      supabase.from("profiles").select("*").order("created_at", { ascending: true })
    ]);

    if (storesResult.error) {
      setError(storesResult.error.message);
    } else if (profilesResult.error) {
      setError(profilesResult.error.message);
    } else {
      const nextProfiles = profilesResult.data ?? [];
      setStores(storesResult.data ?? []);
      setProfiles(nextProfiles);
      setDraftNames(Object.fromEntries(nextProfiles.map((profile) => [profile.id, profile.display_name])));
    }

    setLoading(false);
  }

  async function saveName(profile: StaffProfile) {
    const displayName = draftNames[profile.id]?.trim();
    if (!displayName) {
      setError("이름은 비워둘 수 없습니다.");
      return;
    }

    setError("");
    setMessage("");

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq("id", profile.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage("사용자 이름을 저장했습니다.");
      await loadUsers();
    }
  }

  async function deleteProfile(profile: StaffProfile) {
    const label = profile.email ?? profile.display_name;
    if (!window.confirm(`${label} 사용자를 목록에서 삭제하시겠습니까?`)) {
      return;
    }

    setError("");
    setMessage("");

    const { error: deleteError } = await supabase.from("profiles").delete().eq("id", profile.id);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage("사용자를 삭제했습니다.");
      await loadUsers();
    }
  }

  return (
    <section>
      <PageTitle title="전체 사용자" description="매장별 사용자를 확인하고 이름을 수정하거나 삭제합니다." />

      {loading ? <StatusMessage>사용자 목록을 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="space-y-4">
          {Object.entries(groupedProfiles).map(([storeName, storeProfiles]) => (
            <div key={storeName} className="panel overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-base font-black">{storeName}</h2>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{storeProfiles.length}명</p>
              </div>
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-3">계정</th>
                    <th className="px-3 py-3">이름</th>
                    <th className="w-20 px-3 py-3">권한</th>
                    <th className="w-24 px-3 py-3 text-right">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {storeProfiles.map((profile) => (
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
                          {ROLE_LABEL[roleOf(profile)]}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => saveName(profile)}
                            className="touch-button inline-flex items-center justify-center rounded-md border border-slate-300 px-2 dark:border-slate-700"
                            aria-label="이름 저장"
                            title="저장"
                          >
                            <Save size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteProfile(profile)}
                            className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-2 text-red-600 dark:border-red-900 dark:text-red-300"
                            aria-label="사용자 삭제"
                            title="삭제"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {profiles.length === 0 ? <StatusMessage>등록된 사용자가 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
