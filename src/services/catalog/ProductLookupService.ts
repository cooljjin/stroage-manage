import { validateGtin, type GtinFormat } from "../../lib/gtin";
import type { ProductCandidate, ProductLookupResult } from "../../types/productLookup";
import { normalizeServiceError } from "../errors";
import { DatabaseService } from "../database/DatabaseService";

const candidateColumns = [
  "gtin",
  "canonical_name",
  "brand",
  "manufacturer",
  "size",
  "unit",
  "quantity_text",
  "image_url",
  "source",
  "source_url",
  "license",
  "image_license",
  "confidence"
].join(", ");

export const ProductLookupService = {
  async lookup(input: string, format?: GtinFormat): Promise<ProductLookupResult> {
    const validation = validateGtin(input, format);
    if (validation.status !== "valid") {
      return { status: validation.status, input, reason: validation.reason, format };
    }

    try {
      const { data, error } = await DatabaseService.select("product_catalog", candidateColumns, {
        filters: [{ column: "gtin", operator: "eq", value: validation.gtin14 }],
        maybeSingle: true
      });

      if (error) {
        return {
          status: "unavailable",
          input,
          gtin: validation.gtin14,
          error: normalizeServiceError(error) ?? { message: "상품 카탈로그를 조회할 수 없습니다." }
        };
      }
      if (!data) return { status: "miss", input, gtin: validation.gtin14 };
      return { status: "hit", input, gtin: validation.gtin14, candidate: data as ProductCandidate };
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