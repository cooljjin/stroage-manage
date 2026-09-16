import { validateGtin, type GtinFormat } from "../../lib/gtin";
import type { ProductCandidate, ProductLookupResult } from "../../types/productLookup";
import { normalizeServiceError } from "../errors";
import { DatabaseService } from "../database/DatabaseService";

export const ProductLookupService = {
  async lookup(input: string, format?: GtinFormat): Promise<ProductLookupResult> {
    const validation = validateGtin(input, format);
    if (validation.status !== "valid") {
      return { status: validation.status, input, reason: validation.reason, format };
    }

    try {
      const { data, error } = await DatabaseService.rpc("lookup_shared_product_catalog", {
        target_gtin: validation.gtin14
      });

      if (error) {
        return {
          status: "unavailable",
          input,
          gtin: validation.gtin14,
          error: normalizeServiceError(error) ?? { message: "상품 카탈로그를 조회할 수 없습니다." }
        };
      }
      const candidate = (Array.isArray(data) ? data[0] : data) as ProductCandidate | null;
      if (!candidate) return { status: "miss", input, gtin: validation.gtin14 };
      return { status: "hit", input, gtin: validation.gtin14, candidate };
    } catch (error) {
      return {
        status: "unavailable",
        input,
        gtin: validation.gtin14,
        error: normalizeServiceError(error) ?? { message: "상품 카탈로그를 조회할 수 없습니다." }
      };
    }
  }
};