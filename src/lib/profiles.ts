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
