import { DEFAULT_PRODUCT_UNITS, type ProductUnit } from "../types/domain";
import * as Services from "../services";

export async function loadProductUnits(options?: { activeOnly?: boolean }): Promise<ProductUnit[]> {
  let query = Services.DatabaseService.select("product_units", "*").order("sort_order", { ascending: true }).order("name", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export function fallbackProductUnits(): ProductUnit[] {
  return DEFAULT_PRODUCT_UNITS.map((name, index) => ({
    id: name,
    name,
    is_active: true,
    sort_order: index + 1,
    created_at: new Date(0).toISOString()
  }));
}
