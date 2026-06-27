import type { Session } from "@supabase/supabase-js";
import type { StaffProfile } from "../types/domain";
import { supabase } from "./supabase";

export async function ensureCurrentProfile(session: Session): Promise<StaffProfile | null> {
  const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();

  if (error) {
    return null;
  }

  if (profile) {
    const email = session.user.email ?? null;
    if (profile.email !== email) {
      await supabase.from("profiles").update({ email }).eq("id", session.user.id);
    }
    return profile;
  }

  return null;
}

export async function getCurrentStoreId(): Promise<{ storeId: string | null; errorMessage: string }> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { storeId: null, errorMessage: userError?.message ?? "로그인이 필요합니다." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("store_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return { storeId: null, errorMessage: profileError.message };
  }

  return { storeId: profile?.store_id ?? null, errorMessage: profile?.store_id ? "" : "매장 정보가 필요합니다." };
}
