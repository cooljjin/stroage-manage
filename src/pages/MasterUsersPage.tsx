import { useEffect, useMemo, useState } from "react";
import { Copy, Save, Trash2, UserPlus, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { supabase } from "../lib/supabase";
import type { ProfileRole, StaffProfile, Store, StoreInvite } from "../types/domain";

const ROLE_LABEL: Record<ProfileRole, string> = {
  master: "마스터",
  store_admin: "관리자",
  staff: "직원"
};

function roleOf(profile: StaffProfile): ProfileRole {
  return profile.role ?? (profile.is_admin ? "store_admin" : "staff");
}

function formatDeleteUserError(message: string | undefined) {
  if (!message) return "사용자 삭제에 실패했습니다.";
  if (message.includes("Failed to send a request")) {
    return "사용자 삭제용 Edge Function이 배포되지 않았거나 접근할 수 없습니다. delete-auth-user 함수를 배포해 주세요.";
  }
  return message;
}

export function MasterUsersPage() {
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [draftStoreIds, setDraftStoreIds] = useState<Record<string, string>>({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStoreId, setInviteStoreId] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<ProfileRole, "master">>("staff");
  const [createdInvite, setCreatedInvite] = useState<StoreInvite | null>(null);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const storeNameById = useMemo(() => {
    return new Map(stores.map((store) => [store.id, store.name]));
  }, [stores]);

  const inviteLink = useMemo(() => {
    if (!createdInvite) return "";
    return `${window.location.origin}/invite/${createdInvite.token}`;
  }, [createdInvite]);

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
      setDraftStoreIds(Object.fromEntries(nextProfiles.map((profile) => [profile.id, profile.store_id])));
      setInviteStoreId((current) => current || storesResult.data?.[0]?.id || "");
    }

    setLoading(false);
  }

  async function createInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setError("초대할 이메일을 입력해 주세요.");
      return;
    }
    if (!inviteStoreId) {
      setError("초대할 매장을 선택해 주세요.");
      return;
    }

    setInviteSaving(true);
    setError("");
    setMessage("");
    setCreatedInvite(null);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError(userError?.message ?? "로그인이 필요합니다.");
      setInviteSaving(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("store_invites")
      .delete()
      .eq("store_id", inviteStoreId)
      .eq("email", email)
      .is("accepted_at", null);

    if (deleteError) {
      setError(deleteError.message);
      setInviteSaving(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("store_invites")
      .insert({
        store_id: inviteStoreId,
        email,
        role: inviteRole,
        invited_by: userData.user.id
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
    } else {
      setCreatedInvite(data);
      setMessage("초대 링크를 생성했습니다.");
    }

    setInviteSaving(false);
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setMessage("초대 링크를 복사했습니다.");
  }

  async function saveProfile(profile: StaffProfile) {
    const displayName = draftNames[profile.id]?.trim();
    const storeId = draftStoreIds[profile.id];
    if (!displayName) {
      setError("이름은 비워둘 수 없습니다.");
      return;
    }
    if (!storeId) {
      setError("배정할 매장을 선택해 주세요.");
      return;
    }

    setError("");
    setMessage("");

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ display_name: displayName, store_id: storeId, updated_at: new Date().toISOString() })
      .eq("id", profile.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage("사용자 정보를 저장했습니다.");
      await loadUsers();
    }
  }

  async function deleteProfile(profile: StaffProfile) {
    const label = profile.email ?? profile.display_name;
    if (!window.confirm(`${label} 사용자를 완전히 삭제하시겠습니까?\n삭제하면 다시 같은 이메일로 회원가입할 수 있습니다.`)) {
      return;
    }

    setError("");
    setMessage("");

    const { data, error: deleteError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("delete-auth-user", {
      body: { userId: profile.id }
    });

    if (deleteError || data?.error) {
      setError(formatDeleteUserError(data?.error ?? deleteError?.message));
    } else {
      setMessage("사용자를 완전히 삭제했습니다.");
      await loadUsers();
    }
  }

  return (
    <section>
      <PageTitle
        title="전체 사용자"
        description="매장별 사용자를 확인하고 이름을 수정하거나 삭제합니다."
        action={
          <button type="button" onClick={() => setInviteOpen((open) => !open)} className="primary-button inline-flex items-center gap-2 whitespace-nowrap">
            {inviteOpen ? <X size={18} /> : <UserPlus size={18} />}
            직원 초대
          </button>
        }
      />

      {inviteOpen ? (
        <div className="panel mb-4 space-y-3 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_150px_auto] lg:items-end">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">초대 이메일</span>
              <input className="field" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="staff@example.com" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">배정 매장</span>
              <select className="field" value={inviteStoreId} onChange={(event) => setInviteStoreId(event.target.value)}>
                <option value="" disabled>
                  매장 선택
                </option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">권한</span>
              <select className="field" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<ProfileRole, "master">)}>
                <option value="staff">직원</option>
                <option value="store_admin">관리자</option>
              </select>
            </label>
            <button type="button" onClick={createInvite} className="primary-button inline-flex items-center justify-center gap-2" disabled={inviteSaving}>
              <UserPlus size={18} />
              {inviteSaving ? "생성 중..." : "링크 생성"}
            </button>
          </div>

          {inviteLink ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="field flex-1" value={inviteLink} readOnly />
              <button type="button" onClick={copyInviteLink} className="secondary-button inline-flex items-center justify-center gap-2">
                <Copy size={18} />
                복사
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

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
                    <th className="px-3 py-3">배정 매장</th>
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
                        <select
                          className="field min-h-11 py-2"
                          value={draftStoreIds[profile.id] ?? ""}
                          onChange={(event) => setDraftStoreIds((value) => ({ ...value, [profile.id]: event.target.value }))}
                        >
                          <option value="" disabled>
                            매장 선택
                          </option>
                          {stores.map((store) => (
                            <option key={store.id} value={store.id}>
                              {store.name}
                            </option>
                          ))}
                        </select>
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
                            onClick={() => saveProfile(profile)}
                            className="touch-button inline-flex items-center justify-center rounded-md border border-slate-300 px-2 dark:border-slate-700"
                            aria-label="사용자 정보 저장"
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
