import type { StaffProfile } from "../types/domain";
import * as Services from "../services";
import type { Session } from "../services";

export async function ensureCurrentProfile(session: Session): Promise<StaffProfile | null> {
  const { data: profile, error } = await Services.DatabaseService.select("profiles", "*").eq("id", session.user.id).maybeSingle();

  if (error) {
    return null;
  }

  if (profile) {
    const email = session.user.email ?? null;
    if (profile.email !== email) {
      await Services.DatabaseService.update("profiles", { email }).eq("id", session.user.id);
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

  const { data: profile, error: profileError } = await Services.DatabaseService.select("profiles", "store_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return { storeId: null, errorMessage: profileError.message };
  }

  return { storeId: profile?.store_id ?? null, errorMessage: profile?.store_id ? "" : "매장 정보가 필요합니다." };
}
