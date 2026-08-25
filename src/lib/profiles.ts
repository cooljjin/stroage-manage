import type { StaffProfile } from "../types/domain";
import * as Services from "../services";
import type { Session } from "../services";

export async function ensureCurrentProfile(session: Session): Promise<StaffProfile | null> {
  const { data: profile, error } = await Services.DatabaseService.rpc("get_my_profile");

  if (error) {
    return null;
  }

  if (profile) {
    const email = session.user.email ?? null;
    if (profile.email !== email) {
      const { data: syncedProfile, error: syncError } = await Services.DatabaseService.rpc("sync_my_profile_email");
      if (!syncError && syncedProfile) return syncedProfile;
    }
    return profile;
  }

  return null;
}

export async function getCurrentStoreId(): Promise<{ storeId: string | null; errorMessage: string }> {
  const { data: userData, error: userError } = await Services.AuthService.getUser();
  if (userError || !userData.user) {
    return { storeId: null, errorMessage: userError?.message ?? "로그인이 필요합니다." };
  }

  const { data: profile, error: profileError } = await Services.DatabaseService.rpc("get_my_profile");

  if (profileError) {
    return { storeId: null, errorMessage: profileError.message };
  }

  return { storeId: profile?.store_id ?? null, errorMessage: profile?.store_id ? "" : "매장 정보가 필요합니다." };
}
