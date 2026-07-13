import * as Services from "../services";

type ResolvedStaffName = {
  user_id: string;
  display_name: string;
};

export async function resolveStoreStaffNames(storeId: string, userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const staffNames = new Map<string, string>();
  if (uniqueUserIds.length === 0) return staffNames;

  const { data, error } = await Services.DatabaseService.rpc("resolve_store_staff_names", {
    target_store_id: storeId,
    user_ids: uniqueUserIds
  });

  if (error) return staffNames;

  ((data ?? []) as ResolvedStaffName[]).forEach((row) => {
    staffNames.set(row.user_id, row.display_name);
  });

  return staffNames;
}

