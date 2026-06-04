import type { Session } from "@supabase/supabase-js";
import type { StaffProfile } from "../types/domain";
import { supabase } from "./supabase";

function fallbackDisplayName(email: string | null | undefined): string {
  return email?.split("@")[0] || "직원";
}

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

  const { data: createdProfile, error: createError } = await supabase
    .from("profiles")
    .insert({
      id: session.user.id,
      email: session.user.email ?? null,
      display_name: fallbackDisplayName(session.user.email),
      is_admin: false
    })
    .select()
    .single();

  if (createError) {
    return null;
  }

  return createdProfile;
}
