import { DEFAULT_PRODUCT_UNITS, type ProductUnit } from "../types/domain";
import * as Services from "../services";

export async function loadProductUnits(storeId: string, options?: { activeOnly?: boolean }): Promise<ProductUnit[]> {
  let query = Services.DatabaseService.select("product_units", "*").eq("store_id", storeId).order("sort_order", { ascending: true }).order("name", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export function fallbackProductUnits(storeId: string): ProductUnit[] {
  return DEFAULT_PRODUCT_UNITS.map((name, index) => ({
    id: name,
    store_id: storeId,
    name,
    is_active: true,
    sort_order: index + 1,
    created_at: new Date(0).toISOString()
  }));
}
