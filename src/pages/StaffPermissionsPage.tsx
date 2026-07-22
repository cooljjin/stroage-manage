import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { STAFF_PERMISSION_OPTIONS } from "../lib/staffPermissions";
import * as Services from "../services";
import type { StaffPermission, StaffPermissionKey, StaffProfile } from "../types/domain";

type Props = {
  currentStoreId: string;
};

function getProfileRole(profile: StaffProfile) {
  return profile.role ?? (profile.is_admin ? "store_admin" : "staff");
}

export function StaffPermissionsPage({ currentStoreId }: Props) {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [permissionsByUser, setPermissionsByUser] = useState<Record<string, Set<StaffPermissionKey>>>({});
  const [savingKey, setSavingKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    const [profilesResult, permissionsResult] = await Promise.all([
      Services.DatabaseService.select("profiles", "*").eq("store_id", currentStoreId).order("display_name", { ascending: true }),
      Services.DatabaseService.select("staff_permissions", "*").eq("store_id", currentStoreId)
    ]);

    if (profilesResult.error || permissionsResult.error) {
      setError(profilesResult.error?.message ?? permissionsResult.error?.message ?? "권한 정보를 불러오지 못했습니다.");
      setLoading(false);
      return;
    }

    const nextPermissions: Record<string, Set<StaffPermissionKey>> = {};
    ((permissionsResult.data ?? []) as StaffPermission[]).forEach((permission) => {
      (nextPermissions[permission.user_id] ??= new Set()).add(permission.permission_key);
    });
    setStaff(((profilesResult.data ?? []) as StaffProfile[]).filter((profile) => getProfileRole(profile) === "staff"));
    setPermissionsByUser(nextPermissions);
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function togglePermission(userId: string, permission: StaffPermissionKey) {
    const savingId = `${userId}:${permission}`;
    if (savingKey) return;

    setSavingKey(savingId);
    setError("");
    setMessage("");
    const enabled = permissionsByUser[userId]?.has(permission) ?? false;
    const result = enabled
      ? await Services.DatabaseService.delete("staff_permissions").eq("store_id", currentStoreId).eq("user_id", userId).eq("permission_key", permission)
      : await Services.DatabaseService.insert("staff_permissions", { store_id: currentStoreId, user_id: userId, permission_key: permission });

    if (result.error) {
      setError(result.error.message);
    } else {
      setPermissionsByUser((current) => {
        const next = { ...current, [userId]: new Set(current[userId] ?? []) };
        if (enabled) next[userId].delete(permission);
        else next[userId].add(permission);
        return next;
      });
      setMessage(enabled ? "직원 권한을 해제했습니다." : "직원 권한을 부여했습니다.");
    }
    setSavingKey("");
  }

  return (
    <section>
      <PageTitle title="권한 부여" description="일반 직원에게 필요한 관리 작업만 선택해서 부여합니다." />

      {loading ? <StatusMessage>직원 권한을 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="panel overflow-x-auto">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="sticky left-0 bg-slate-100 px-3 py-3 dark:bg-slate-900">직원</th>
                {STAFF_PERMISSION_OPTIONS.map((permission) => <th key={permission.key} className="px-3 py-3 text-center">{permission.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {staff.map((profile) => (
                <tr key={profile.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="sticky left-0 bg-white px-3 py-3 font-semibold dark:bg-slate-950">
                    <span className="block">{profile.display_name}</span>
                    <span className="block max-w-40 truncate text-xs font-normal text-slate-500 dark:text-slate-400">{profile.email ?? "이메일 없음"}</span>
                  </td>
                  {STAFF_PERMISSION_OPTIONS.map((permission) => {
                    const checked = permissionsByUser[profile.id]?.has(permission.key) ?? false;
                    const saving = savingKey === `${profile.id}:${permission.key}`;
                    return (
                      <td key={permission.key} className="px-3 py-3 text-center">
                        <label className="inline-flex cursor-pointer items-center justify-center" title={`${profile.display_name} ${permission.label} 권한`}>
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-brand-600"
                            checked={checked}
                            disabled={Boolean(savingKey)}
                            onChange={() => void togglePermission(profile.id, permission.key)}
                          />
                          <span className="sr-only">{permission.label}</span>
                        </label>
                        {saving ? <span className="sr-only">저장 중</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {staff.length === 0 ? <div className="p-4"><StatusMessage>권한을 부여할 일반 직원이 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}

      <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><ShieldCheck size={16} />권한을 부여받은 직원에게만 해당 메뉴와 작업 화면이 표시됩니다.</p>
    </section>
  );
}
