import type { BarcodeScanMetadata, BarcodeSymbology, MobileInventoryEntryMode } from "../types/domain";

const PENDING_SCAN_TTL_MS = 5 * 60 * 1000;

export type PendingScanEntry = {
  barcode: string;
  storeId: string;
  savedAt: number;
  initialInventoryMode?: MobileInventoryEntryMode;
  barcodeFormat?: BarcodeSymbology;
};

const KNOWN_SYMBOLOGIES = new Set<BarcodeSymbology>([
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "CODE_128",
  "CODE_39",
  "CODE_93",
  "ITF",
  "CODABAR"
]);

export function normalizeBarcodeFormat(value: unknown): BarcodeSymbology | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  return KNOWN_SYMBOLOGIES.has(normalized as BarcodeSymbology) ? normalized as BarcodeSymbology : "UNKNOWN";
}

export function barcodeScanMetadata(value: unknown): BarcodeScanMetadata {
  if (!value || typeof value !== "object") return {};
  const barcodeFormat = normalizeBarcodeFormat((value as { barcodeFormat?: unknown }).barcodeFormat);
  return barcodeFormat ? { barcodeFormat } : {};
}

export function consumePendingScanEntry(rawEntry: string | null, storeId: string, now = Date.now()): PendingScanEntry | null {
  if (!rawEntry) return null;

  try {
    const entry = JSON.parse(rawEntry) as PendingScanEntry;
    if (entry.storeId !== storeId || now - entry.savedAt > PENDING_SCAN_TTL_MS || typeof entry.barcode !== "string") return null;
    const entryWithoutFormat = { ...entry };
    delete entryWithoutFormat.barcodeFormat;
    return entry.barcode.trim() ? { ...entryWithoutFormat, ...barcodeScanMetadata(entry), initialInventoryMode: entry.initialInventoryMode ?? "auto" } : null;
  } catch {
    return null;
  }
}

export function getWebBarcodeScanResult(decodedText: string, result?: { result?: { format?: { formatName?: string } } }) {
  const barcodeFormat = normalizeBarcodeFormat(result?.result?.format?.formatName);
  return barcodeFormat ? { barcode: decodedText, barcodeFormat } : { barcode: decodedText };
}
