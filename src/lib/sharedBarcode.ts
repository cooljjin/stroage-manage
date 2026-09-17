import { validateGtin } from "./gtin.ts";
import type { BarcodeSymbology } from "../types/domain.ts";

export type SharedBarcodeFormat = "GTIN" | "CODE_128" | "CODE_39" | "CODE_93" | "ITF" | "CODABAR";

export type SharedBarcodeIdentity = {
  format: SharedBarcodeFormat;
  value: string;
  key: string;
  externalLookupEligible: boolean;
};

const MAX_SHARED_BARCODE_LENGTH = 128;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;
const CODE39_PATTERN = PRINTABLE_ASCII_PATTERN;
const CODE93_PATTERN = PRINTABLE_ASCII_PATTERN;
const CODABAR_PATTERN = /^[0-9A-Da-d\-$:/.+]+$/;

export function normalizeSharedBarcodeIdentity(rawValue: string, rawFormat?: BarcodeSymbology): SharedBarcodeIdentity | null {
  const isGtinFormat = rawFormat === "EAN_13" || rawFormat === "EAN_8" || rawFormat === "UPC_A";
  const value = isGtinFormat ? rawValue.trim() : rawValue;
  if (!value || !value.trim() || value.length > MAX_SHARED_BARCODE_LENGTH) return null;
  if ([...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })) return null;

  if (rawFormat === "EAN_13" || rawFormat === "EAN_8" || rawFormat === "UPC_A") {
    const format = rawFormat === "EAN_13" ? "EAN13" : rawFormat === "EAN_8" ? "EAN8" : "UPC_A";
    const validation = validateGtin(value, format);
    if (validation.status !== "valid") return null;
    return {
      format: "GTIN",
      value: validation.gtin14,
      key: `GTIN:${validation.gtin14}`,
      externalLookupEligible: true
    };
  }

  if (rawFormat === "CODE_128") {
    if (!PRINTABLE_ASCII_PATTERN.test(value)) return null;
    return { format: rawFormat, value, key: `${rawFormat}:${value}`, externalLookupEligible: false };
  }

  if (rawFormat === "CODE_39" || rawFormat === "CODE_93") {
    const pattern = rawFormat === "CODE_39" ? CODE39_PATTERN : CODE93_PATTERN;
    if (!pattern.test(value)) return null;
    return { format: rawFormat, value, key: `${rawFormat}:${value}`, externalLookupEligible: false };
  }

  if (rawFormat === "ITF") {
    if (!/^[0-9]+$/.test(value) || value.length % 2 !== 0) return null;
    return { format: rawFormat, value, key: `${rawFormat}:${value}`, externalLookupEligible: false };
  }

  if (rawFormat === "CODABAR") {
    if (!CODABAR_PATTERN.test(value)) return null;
    return { format: rawFormat, value, key: `${rawFormat}:${value}`, externalLookupEligible: false };
  }

  return null;
}
