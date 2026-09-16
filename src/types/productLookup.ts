import type { GtinFormat } from "../lib/gtin.ts";
import type { ProductCatalog } from "./domain";
import type { ServiceError } from "../services/errors";

export type ProductCandidate = Pick<
  ProductCatalog,
  | "gtin"
  | "canonical_name"
  | "brand"
  | "manufacturer"
  | "size"
  | "unit"
  | "quantity_text"
  | "image_url"
  | "source"
  | "source_url"
  | "license"
  | "image_license"
  | "confidence"
  | "category"
  | "storage_type"
  | "supplier_name"
  | "product_url"
>;

export type ProductLookupResult =
  | { status: "hit"; input: string; gtin: string; candidate: ProductCandidate }
  | { status: "miss"; input: string; gtin: string }
  | { status: "invalid"; input: string; reason: string; format?: GtinFormat }
  | { status: "ambiguous"; input: string; reason: string; format?: GtinFormat }
  | { status: "unavailable"; input: string; gtin?: string; error: ServiceError }
  | { status: "rate_limited"; input: string; gtin?: string; retryAfterSeconds?: number };