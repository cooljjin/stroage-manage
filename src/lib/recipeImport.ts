import type { WorkSheet } from "xlsx";

export const RECIPE_IMPORT_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const RECIPE_IMPORT_ACCEPT = ".xlsx,.xls,.csv,.pdf";
export const RECIPE_IMPORT_MODEL = "gemini-2.5-flash-lite";
// Conservative paid-tier estimate for the default Gemini 2.5 Flash-Lite model.
// Actual billing can be lower when the project is using the free tier.
export const RECIPE_IMPORT_INPUT_PRICE_PER_MILLION = 0.18;
export const RECIPE_IMPORT_OUTPUT_PRICE_PER_MILLION = 0.72;

export type RecipeImportSourceType = "xlsx" | "xls" | "csv" | "pdf";

export type RecipeImportSheetManifest = {
  name: string;
  rows: unknown[][];
  merges: Array<{ start: { row: number; column: number }; end: { row: number; column: number } }>;
};

export type RecipeImportManifest = {
  sourceType: RecipeImportSourceType;
  fileName: string;
  fileSize: number;
  pageCount?: number;
  sheets?: RecipeImportSheetManifest[];
  cellCount?: number;
};

export type RecipeImportEstimate = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  model: string;
};

export function getRecipeSourceType(fileName: string): RecipeImportSourceType | null {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "xlsx" || extension === "xls" || extension === "csv" || extension === "pdf") return extension;
  return null;
}

export function normalizeRecipeImportName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

export async function hashRecipeImportFile(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value).replace(/\r\n/g, "\n").trim();
  return text || null;
}

function normalizeMerges(sheet: WorkSheet) {
  return (sheet["!merges"] ?? []).map((merge) => ({
    start: { row: merge.s.r, column: merge.s.c },
    end: { row: merge.e.r, column: merge.e.c }
  }));
}

async function readWorkbook(file: File, sourceType: RecipeImportSourceType): Promise<RecipeImportManifest> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellFormula: true, cellHTML: false, cellNF: true, cellStyles: false });
  const sheets: RecipeImportSheetManifest[] = [];
  let cellCount = 0;

  if (workbook.SheetNames.length === 0) {
    throw new Error("읽을 수 있는 시트가 없습니다. Microsoft Excel 또는 Google Sheets에서 새 XLSX 파일로 저장한 뒤 다시 시도해 주세요.");
  }

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      throw new Error("일부 시트를 읽지 못했습니다. Microsoft Excel 또는 Google Sheets에서 새 XLSX 파일로 저장한 뒤 다시 시도해 주세요.");
    }
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null, blankrows: false });
    const rows = rawRows.map((row) => row.map(normalizeCell));
    cellCount += rows.reduce((sum, row) => sum + row.length, 0);
    if (cellCount > 100_000) throw new Error("엑셀 데이터가 너무 큽니다. 10만 셀 이하 파일로 나눠 주세요.");
    sheets.push({ name, rows, merges: normalizeMerges(sheet) });
  }

  return { sourceType, fileName: file.name, fileSize: file.size, sheets, cellCount };
}

async function countPdfPages(file: File) {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    return document.numPages;
  } catch {
    // A page count is an estimate only; the Edge Function will validate the PDF again.
    return Math.max(1, Math.ceil(file.size / (500 * 1024)));
  }
}

export async function preflightRecipeImport(file: File): Promise<RecipeImportManifest> {
  if (file.size <= 0) throw new Error("빈 파일은 가져올 수 없습니다.");
  if (file.size > RECIPE_IMPORT_MAX_FILE_SIZE) throw new Error("파일은 50MB 이하만 가져올 수 있습니다.");
  const sourceType = getRecipeSourceType(file.name);
  if (!sourceType) throw new Error("지원 형식은 XLSX, XLS, CSV, PDF입니다.");
  if (sourceType === "pdf") return { sourceType, fileName: file.name, fileSize: file.size, pageCount: await countPdfPages(file) };
  return readWorkbook(file, sourceType);
}

export function estimateRecipeImportCost(manifest: RecipeImportManifest): RecipeImportEstimate {
  const inputTokens = manifest.sourceType === "pdf"
    ? Math.max(1_500, Math.ceil((manifest.pageCount ?? 1) * 1_700))
    : Math.max(1_000, Math.ceil((manifest.cellCount ?? 0) * 8 + manifest.fileSize / 160));
  const outputTokens = Math.max(500, Math.ceil(inputTokens * 0.35));
  const estimatedCostUsd = Math.max(0.01, Number(((inputTokens * RECIPE_IMPORT_INPUT_PRICE_PER_MILLION + outputTokens * RECIPE_IMPORT_OUTPUT_PRICE_PER_MILLION) / 1_000_000).toFixed(4)));
  return { inputTokens, outputTokens, estimatedCostUsd, model: RECIPE_IMPORT_MODEL };
}

export function formatRecipeImportCost(cost: number) {
  return `$${cost.toFixed(4)}`;
}
