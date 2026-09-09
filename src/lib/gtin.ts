export type GtinFormat = "EAN8" | "UPC_E" | "UPC_A" | "EAN13" | "GTIN14";

type ValidGtin = {
  status: "valid";
  original: string;
  format: Exclude<GtinFormat, "UPC_E">;
  gtin14: string;
};

type InvalidGtin = {
  status: "invalid";
  original: string;
  reason: "non_ascii_digits" | "unsupported_length" | "format_length" | "checksum";
};

type AmbiguousGtin = {
  status: "ambiguous";
  original: string;
  format: "UPC_E" | "EAN8" | undefined;
  reason: "format_required" | "upc_e_not_supported";
};

export type GtinValidationResult = ValidGtin | InvalidGtin | AmbiguousGtin;

const formatLengths: Record<Exclude<GtinFormat, "UPC_E">, number> = {
  EAN8: 8,
  UPC_A: 12,
  EAN13: 13,
  GTIN14: 14
};

function hasValidChecksum(value: string): boolean {
  const checkDigit = Number(value[value.length - 1]);
  const body = value.slice(0, -1);
  let sum = checkDigit;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return sum % 10 === 0;
}

export function validateGtin(value: string, format?: GtinFormat): GtinValidationResult {
  const original = value;
  const isAsciiDigits = /^[0-9]+$/.test(value);
  if (!isAsciiDigits) return { status: "invalid", original, reason: "non_ascii_digits" };

  if (format === "UPC_E") {
    if (value.length !== 8) return { status: "invalid", original, reason: "format_length" };
    return { status: "ambiguous", original, format, reason: "upc_e_not_supported" };
  }

  if (value.length === 8 && format === undefined) {
    return { status: "ambiguous", original, format: undefined, reason: "format_required" };
  }

  const inferredFormat: Exclude<GtinFormat, "UPC_E"> | undefined = format ?? ({ 12: "UPC_A", 13: "EAN13", 14: "GTIN14" } as const)[value.length];
  if (!inferredFormat || formatLengths[inferredFormat] !== value.length) {
    return { status: "invalid", original, reason: inferredFormat ? "format_length" : "unsupported_length" };
  }
  if (!hasValidChecksum(value)) return { status: "invalid", original, reason: "checksum" };

  return { status: "valid", original, format: inferredFormat, gtin14: value.padStart(14, "0") };
}
