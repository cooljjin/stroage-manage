import type { ProductSupplier } from "../types/domain";
import { supabase } from "./supabase";

const DEFAULT_SUPPLIERS = ["쿠팡", "쿠팡 프레시"] as const;

export async function loadSuppliers(options?: { activeOnly?: boolean }): Promise<ProductSupplier[]> {
  let query = supabase.from("suppliers").select("*").order("name", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export function fallbackSuppliers(): ProductSupplier[] {
  return DEFAULT_SUPPLIERS.map((name) => ({
    id: name,
    name,
    is_active: true,
    created_at: new Date(0).toISOString()
  }));
}
