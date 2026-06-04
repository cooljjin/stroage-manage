import { DEFAULT_CATEGORIES, type ProductCategory } from "../types/domain";
import { supabase } from "./supabase";

export async function loadCategories(options?: { activeOnly?: boolean }): Promise<ProductCategory[]> {
  let query = supabase.from("categories").select("*").order("name", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export function fallbackCategories(): ProductCategory[] {
  return DEFAULT_CATEGORIES.map((name) => ({
    id: name,
    name,
    is_active: true,
    created_at: new Date(0).toISOString()
  }));
}
