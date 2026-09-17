import { validateGtin, type GtinFormat } from "../../lib/gtin";
import { normalizeSharedBarcodeIdentity } from "../../lib/sharedBarcode";
import type { BarcodeSymbology } from "../../types/domain";
import type { ProductCandidate, ProductLookupResult } from "../../types/productLookup";
import { normalizeServiceError } from "../errors";
import { DatabaseService } from "../database/DatabaseService";

type LookupFormat = GtinFormat | BarcodeSymbology;
type LookupRow = ProductCandidate & {
  status?: "hit" | "miss" | "rate_limited" | "invalid";
  barcode_format?: string | null;
  barcode_value?: string | null;
};

const formatAliases: Partial<Record<LookupFormat, string>> = {
  EAN8: "EAN_8",
  UPC_A: "UPC_A",
  EAN13: "EAN_13",
  GTIN14: "GTIN14"
};

function toRpcFormat(format?: LookupFormat): string | undefined {
  if (!format) return undefined;
  return formatAliases[format] ?? format;
}

export const ProductLookupService = {
  async lookup(input: string, format?: LookupFormat): Promise<ProductLookupResult> {
    let rpcFormat = toRpcFormat(format);
    let identity;
    const legacyGtinFormat = format && ["EAN8", "UPC_E", "UPC_A", "EAN13", "GTIN14"].includes(format);
    if (legacyGtinFormat || (!format && /^[0-9]+$/.test(input))) {
      const validation = validateGtin(input, format as GtinFormat | undefined);
      if (validation.status !== "valid") return { status: validation.status, input, reason: validation.reason, format };
      identity = { format: "GTIN" as const, value: validation.gtin14, externalLookupEligible: true };
      rpcFormat = toRpcFormat(validation.format);
    } else {
      identity = normalizeSharedBarcodeIdentity(input, format as BarcodeSymbology | undefined);
      if (!identity) return { status: "invalid", input, reason: "unsupported_barcode", format };
    }

    try {
      const { data, error } = await DatabaseService.rpc("lookup_shared_product_catalog_v2", {
        target_barcode: input,
        target_format: rpcFormat ?? null
      });
      if (error) {
        return {
          status: "unavailable",
          input,
          gtin: identity.format === "GTIN" ? identity.value : undefined,
          error: normalizeServiceError(error) ?? { message: "상품 카탈로그를 조회할 수 없습니다." }
        };
      }

      const row = (Array.isArray(data) ? data[0] : data) as LookupRow | null;
      if (!row || row.status === "miss") {
        return {
          status: "miss",
          input,
          gtin: identity.format === "GTIN" ? identity.value : undefined,
          ...(identity.externalLookupEligible ? {} : { externalLookupEligible: false })
        };
      }
      if (row.status === "rate_limited") return { status: "rate_limited", input };
      if (row.status === "invalid") return { status: "invalid", input, reason: "unsupported_barcode", format };

      const candidate = { ...row };
      delete candidate.status;
      delete candidate.barcode_format;
      delete candidate.barcode_value;
      return {
        status: "hit",
        input,
        gtin: identity.format === "GTIN" ? identity.value : undefined,
        candidate,
        ...(identity.externalLookupEligible ? {} : { externalLookupEligible: false })
      };
    } catch (error) {
      return {
        status: "unavailable",
        input,
        gtin: identity.format === "GTIN" ? identity.value : undefined,
        error: normalizeServiceError(error) ?? { message: "상품 카탈로그를 조회할 수 없습니다." }
      };
    }
  }
};
