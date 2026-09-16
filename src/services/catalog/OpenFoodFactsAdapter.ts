import { validateGtin, type GtinFormat } from "../../lib/gtin.ts";
import type { ProductCandidate } from "../../types/productLookup.ts";

const OPEN_FOOD_FACTS_API = "https://world.openfoodfacts.org/api/v2/product";
const REQUEST_TIMEOUT_MS = 5000;
const USER_AGENT = "Stockly/1.0 (scan-triggered Open Food Facts lookup)";
const FIELDS = "code,product_name,product_name_en,brands,quantity,product_quantity,product_quantity_unit,image_url";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type OpenFoodFactsLookupResult =
  | { status: "found"; input: string; gtin: string; candidate: ProductCandidate }
  | { status: "missing"; input: string; gtin: string }
  | { status: "malformed"; input: string; gtin: string; reason: string }
  | { status: "mismatch"; input: string; gtin: string }
  | { status: "timeout"; input: string; gtin: string }
  | { status: "rate_limited"; input: string; gtin: string; retryAfterSeconds?: number }
  | { status: "unavailable"; input: string; gtin: string; reason: string };

type Options = {
  fetch?: FetchLike;
  timeoutMs?: number;
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function makeCandidate(gtin: string, product: Record<string, unknown>, sourceUrl: string): ProductCandidate | null {
  const canonicalName = asNonEmptyString(product.product_name) ?? asNonEmptyString(product.product_name_en);
  if (!canonicalName) return null;

  const brand = asNonEmptyString(product.brands);
  const quantityText = asNonEmptyString(product.quantity);
  const quantity = typeof product.product_quantity === "number" && Number.isFinite(product.product_quantity)
    ? product.product_quantity
    : null;
  const unit = asNonEmptyString(product.product_quantity_unit);

  return {
    gtin,
    canonical_name: canonicalName,
    brand,
    manufacturer: null,
    size: quantity,
    unit,
    quantity_text: quantityText,
    image_url: asNonEmptyString(product.image_url),
    source: "open_food_facts",
    source_url: sourceUrl,
    license: "ODbL-1.0; verify current Open Food Facts terms before persistence",
    image_license: "CC BY-SA 4.0; verify current image attribution before persistence",
    confidence: null
  };
}

export const OpenFoodFactsAdapter = {
  async lookup(input: string, format?: GtinFormat, options: Options = {}): Promise<OpenFoodFactsLookupResult> {
    const validation = validateGtin(input, format);
    if (validation.status !== "valid") {
      return { status: "malformed", input, gtin: input, reason: validation.reason };
    }

    const gtin = validation.gtin14;
    const url = `${OPEN_FOOD_FACTS_API}/${encodeURIComponent(gtin)}.json?fields=${FIELDS}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);

    try {
      const response = await (options.fetch ?? fetch)(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: controller.signal
      });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        return {
          status: "rate_limited",
          input,
          gtin,
          ...(Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {})
        };
      }
      if (!response.ok) return { status: "unavailable", input, gtin, reason: `http_${response.status}` };

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        if (controller.signal.aborted) {
          return { status: "timeout", input, gtin };
        }
        return { status: "malformed", input, gtin, reason: "invalid_json" };
      }
      if (!body || typeof body !== "object") return { status: "malformed", input, gtin, reason: "invalid_response" };

      const payload = body as Record<string, unknown>;
      if (payload.status === 0) return { status: "missing", input, gtin };
      if (payload.status !== 1 || !payload.product || typeof payload.product !== "object") {
        return { status: "malformed", input, gtin, reason: "invalid_product_payload" };
      }

      const returnedCode = asNonEmptyString(payload.code);
      const returnedValidation = returnedCode ? validateGtin(returnedCode) : null;
      if (!returnedValidation || returnedValidation.status !== "valid" || returnedValidation.gtin14 !== gtin) {
        return { status: "mismatch", input, gtin };
      }

      const candidate = makeCandidate(gtin, payload.product as Record<string, unknown>, url);
      return candidate ? { status: "found", input, gtin, candidate } : { status: "malformed", input, gtin, reason: "missing_product_name" };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { status: "timeout", input, gtin };
      return { status: "unavailable", input, gtin, reason: error instanceof Error ? error.message : "network_error" };
    } finally {
      clearTimeout(timeout);
    }
  }
};

export type { OpenFoodFactsLookupResult };
