import * as Services from "../services";
import type { Inventory, InventoryItem, Product } from "../types/domain";
import { normalizeInventoryItem } from "./inventory";

export async function resolveProductByBarcode(
  currentStoreId: string,
  barcodeCandidates: string[]
): Promise<{ product: Product | null; errorMessage: string }> {
  for (const barcode of barcodeCandidates) {
    const { data, error } = await Services.DatabaseService.rpc("resolve_product_by_barcode", {
      target_store_id: currentStoreId,
      target_barcode: barcode
    });
    if (error) return { product: null, errorMessage: error.message };
    if (data?.[0]) return { product: data[0] as Product, errorMessage: "" };
  }

  return { product: null, errorMessage: "" };
}

export async function searchResolvedProducts(
  currentStoreId: string,
  keyword = "",
  resultLimit = 100
): Promise<{ products: Product[]; errorMessage: string }> {
  const { data, error } = await Services.DatabaseService.rpc("search_products_resolved", {
    target_store_id: currentStoreId,
    keyword,
    result_limit: resultLimit
  });

  return {
    products: (data ?? []) as Product[],
    errorMessage: error?.message ?? ""
  };
}

export async function loadResolvedInventoryItems(
  currentStoreId: string,
  keyword = "",
  resultLimit = 500
): Promise<{ items: InventoryItem[]; errorMessage: string }> {
  const productResult = await searchResolvedProducts(currentStoreId, keyword, resultLimit);
  if (productResult.errorMessage) return { items: [], errorMessage: productResult.errorMessage };
  if (productResult.products.length === 0) return { items: [], errorMessage: "" };

  const productIds = productResult.products.map((product) => product.id);
  const { data: inventoryRows, error: inventoryError } = await Services.DatabaseService.select("inventory", "*")
    .eq("store_id", currentStoreId)
    .in("product_id", productIds);

  if (inventoryError) return { items: [], errorMessage: inventoryError.message };

  const inventoryByProductId = new Map(
    ((inventoryRows ?? []) as Inventory[]).map((inventory) => [inventory.product_id, inventory])
  );

  return {
    items: productResult.products.map((product) => normalizeInventoryItem({
      ...product,
      inventory: inventoryByProductId.get(product.id) ?? null
    })),
    errorMessage: ""
  };
}
