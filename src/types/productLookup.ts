import type { GtinFormat } from "../lib/gtin.ts";
import type { BarcodeSymbology, ProductCatalog } from "./domain";
import type { ServiceError } from "../services/errors";

type CandidateFields = Pick<ProductCatalog,
  | "canonical_name" | "brand" | "manufacturer" | "size" | "unit"
  | "quantity_text" | "image_url" | "source" | "source_url" | "license"
  | "image_license" | "confidence" | "category" | "storage_type"
  | "supplier_name" | "product_url"
>;

export type ProductCandidate = CandidateFields & { gtin: string | null };
export type ProductLookupFormat = GtinFormat | BarcodeSymbology;

export type ProductLookupResult =
  | { status: "hit"; input: string; gtin?: string; candidate: ProductCandidate; externalLookupEligible?: boolean }
  | { status: "miss"; input: string; gtin?: string; externalLookupEligible?: boolean }
  | { status: "invalid"; input: string; reason: string; format?: ProductLookupFormat }
  | { status: "ambiguous"; input: string; reason: string; format?: ProductLookupFormat }
  | { status: "unavailable"; input: string; gtin?: string; error: ServiceError }
  | { status: "rate_limited"; input: string; gtin?: string; retryAfterSeconds?: number };
