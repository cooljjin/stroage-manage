import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const PROMPT_VERSION = "recipe-import-v2-gemini-rest";
const INPUT_PRICE_PER_MILLION = 0.18;
const OUTPUT_PRICE_PER_MILLION = 0.72;
const GEMINI_TIMEOUT_MS = 120_000;

type JsonRecord = Record<string, unknown>;
type SourceType = "xlsx" | "xls" | "csv" | "pdf";

type ImportManifest = {
  sourceType: SourceType;
  fileName: string;
  fileSize: number;
  pageCount?: number;
  cellCount?: number;
  sheets?: Array<{ name: string; rows: unknown[][]; merges?: unknown[] }>;
};

type ExtractedIngredient = {
  source_name?: unknown;
  source_quantity?: unknown;
  source_unit?: unknown;
  quantity_per_item?: unknown;
  quantity_unit?: unknown;
  confidence?: unknown;
  warnings?: unknown;
  source_refs?: unknown;
};

type ExtractedMenu = {
  source_key?: unknown;
  name?: unknown;
  sort_order?: unknown;
  yield_quantity?: unknown;
  yield_unit?: unknown;
  confidence?: unknown;
  warnings?: unknown;
  source_refs?: unknown;
  ingredients?: unknown;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Edge Function 환경변수가 설정되지 않았습니다." }, 500);

  const body = await req.json().catch(() => ({})) as JsonRecord;
  if (body.action === "cleanup") return cleanupExpiredSources(supabaseUrl, serviceRoleKey, req);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return jsonResponse({ error: "로그인이 필요합니다." }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return jsonResponse({ error: authError?.message ?? "로그인이 필요합니다." }, 401);

  if (body.action !== "process" || typeof body.jobId !== "string") return jsonResponse({ error: "process와 jobId가 필요합니다." }, 400);
  const jobId = body.jobId;
  const { data: job, error: jobError } = await adminClient.from("recipe_import_jobs").select("*").eq("id", jobId).single();
  if (jobError || !job) return jsonResponse({ error: "가져오기 작업을 찾을 수 없습니다." }, 404);
  if (!(await canManageJob(adminClient, authData.user.id, job.store_id))) return jsonResponse({ error: "레시피 가져오기 권한이 없습니다." }, 403);
  if (!job.storage_path) return failJob(adminClient, jobId, "원본 파일 경로가 없습니다.");
  if (!job.approved_cost_usd || job.approved_cost_usd < job.estimated_cost_usd) return failJob(adminClient, jobId, "예상 비용 승인이 필요합니다.", "awaiting_cost_approval");
  if (!["queued", "processing", "awaiting_cost_approval"].includes(job.status)) return jsonResponse({ ok: true, status: job.status });

  const model = normalizeModel(Deno.env.get("GEMINI_RECIPE_MODEL") ?? DEFAULT_MODEL);
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (!apiKey) return failJob(adminClient, jobId, "GEMINI_API_KEY 환경변수가 없습니다.");

  await adminClient.from("recipe_import_jobs").update({ status: "processing", provider: "google", model, prompt_version: PROMPT_VERSION, error_message: null }).eq("id", jobId);

  try {
    const manifest = isManifest(body.manifest) ? body.manifest : undefined;
    const source = await loadSource(adminClient, job.storage_path, job.source_type as SourceType);
    const prompt = buildPrompt(job.source_type as SourceType, manifest);
    const generation = await callGemini(apiKey, model, job.source_type as SourceType, prompt, source);
    const extracted = parseExtraction(generation.text);
    const products = await loadProducts(adminClient, job.store_id);
    const aliases = await loadAliases(adminClient, job.store_id);
    const menus = normalizeMenus(extracted.menus, products, aliases);
    if (menus.length === 0) throw new Error("레시피 메뉴를 찾지 못했습니다. 표 제목과 재료 행이 포함된 파일인지 확인해 주세요.");

    await adminClient.from("recipe_import_segments").delete().eq("job_id", jobId);
    const { error: segmentError } = await adminClient.from("recipe_import_segments").insert({
      job_id: jobId,
      segment_key: "document",
      segment_kind: job.source_type === "pdf" ? "pdf_pages" : "workbook",
      page_start: job.source_type === "pdf" ? 1 : null,
      page_end: job.source_type === "pdf" ? (manifest?.pageCount ?? null) : null,
      payload: manifest ?? { source_type: job.source_type },
      status: "completed",
      attempt_count: 1,
      extracted_json: extracted,
      input_tokens: generation.inputTokens,
      output_tokens: generation.outputTokens,
      actual_cost_usd: calculateCost(generation.inputTokens, generation.outputTokens)
    });
    if (segmentError) throw segmentError;

    const { error: menuError } = await adminClient.from("recipe_import_menus").delete().eq("job_id", jobId);
    if (menuError) throw menuError;
    const { data: insertedMenus, error: insertMenuError } = await adminClient.from("recipe_import_menus").insert(menus.map((menu) => ({
      job_id: jobId,
      source_key: menu.source_key,
      name: menu.name,
      sort_order: menu.sort_order,
      yield_quantity: menu.yield_quantity,
      yield_unit: menu.yield_unit,
      source_refs: menu.source_refs,
      warnings: menu.warnings,
      confidence: menu.confidence,
      review_status: menu.ingredients.length > 0 && menu.ingredients.every((ingredient) => ingredient.match_status !== "review") ? "ready" : "review",
      decision: "create"
    }))).select("id,source_key");
    if (insertMenuError || !insertedMenus) throw insertMenuError ?? new Error("메뉴 스테이징에 실패했습니다.");

    const ingredientsToInsert: JsonRecord[] = [];
    for (const menu of menus) {
      const menuRow = insertedMenus.find((row: { source_key: string }) => row.source_key === menu.source_key);
      if (!menuRow) continue;
      for (const ingredient of menu.ingredients) ingredientsToInsert.push({ import_menu_id: menuRow.id, ...ingredient });
    }
    const { error: ingredientError } = await adminClient.from("recipe_import_ingredients").insert(ingredientsToInsert);
    if (ingredientError) throw ingredientError;

    const inputTokens = generation.inputTokens;
    const outputTokens = generation.outputTokens;
    const actualCost = calculateCost(inputTokens, outputTokens);
    const overBudget = actualCost > Number(job.approved_cost_usd);
    const status = overBudget ? "awaiting_cost_approval" : menus.some((menu) => menu.ingredients.some((ingredient) => ingredient.match_status === "review")) ? "needs_review" : "ready";
    await adminClient.from("recipe_import_jobs").update({ status, total_segments: 1, completed_segments: 1, input_tokens: inputTokens, output_tokens: outputTokens, actual_cost_usd: actualCost, error_message: overBudget ? "실제 사용량이 승인한 비용을 초과했습니다." : null }).eq("id", jobId);
    return jsonResponse({ ok: true, status, menuCount: menus.length, actualCostUsd: actualCost });
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : "레시피 분석에 실패했습니다.";
    return failJob(adminClient, jobId, message);
  }
});

async function canManageJob(adminClient: ReturnType<typeof createClient>, userId: string, storeId: string) {
  const { data: profile } = await adminClient.from("profiles").select("role,store_id").eq("id", userId).single();
  if (!profile || profile.store_id !== storeId) return false;
  if (profile.role === "store_admin") return true;
  const { data: permission } = await adminClient.from("staff_permissions").select("id").eq("store_id", storeId).eq("user_id", userId).eq("permission_key", "group_order_recipe_management").maybeSingle();
  return Boolean(permission);
}

async function loadProducts(adminClient: ReturnType<typeof createClient>, storeId: string) {
  const { data } = await adminClient.from("products").select("id,name,barcode,store_id,is_active").eq("store_id", storeId).eq("is_active", true);
  return (data ?? []) as Array<{ id: string; name: string; barcode: string | null; store_id: string; is_active: boolean }>;
}

async function loadAliases(adminClient: ReturnType<typeof createClient>, storeId: string) {
  const { data } = await adminClient.from("recipe_product_aliases").select("alias_normalized,product_id").eq("store_id", storeId);
  return (data ?? []) as Array<{ alias_normalized: string; product_id: string }>;
}

async function loadSource(adminClient: ReturnType<typeof createClient>, storagePath: string, sourceType: SourceType) {
  const { data, error } = await adminClient.storage.from("recipe-imports").download(storagePath);
  if (error || !data) throw error ?? new Error("원본 파일을 읽지 못했습니다.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (sourceType === "pdf") return { bytes, mimeType: "application/pdf" };
  return { bytes, mimeType: "application/octet-stream" };
}

async function callGemini(apiKey: string, model: string, sourceType: SourceType, prompt: string, source: { bytes: Uint8Array; mimeType: string }) {
  const parts: JsonRecord[] = [{ text: prompt }];
  if (sourceType === "pdf") parts.push({ inlineData: { mimeType: source.mimeType, data: bytesToBase64(source.bytes) } });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseFormat: {
            text: { mimeType: "application/json", schema: recipeSchema() }
          }
        }
      })
    });
  } catch (requestError) {
    if (requestError instanceof DOMException && requestError.name === "AbortError") {
      throw new Error("Gemini API 요청 시간이 초과되었습니다. 파일을 나누어 다시 시도해 주세요.", { cause: requestError });
    }
    throw new Error("Gemini API에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", { cause: requestError });
  } finally {
    clearTimeout(timeoutId);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiError = (payload as JsonRecord).error as JsonRecord | undefined;
    const apiMessage = typeof apiError?.message === "string" ? apiError.message : "Gemini API 요청에 실패했습니다.";
    if (response.status === 401 || response.status === 403) throw new Error("Gemini API 키가 유효하지 않거나 권한이 없습니다.");
    if (response.status === 429) throw new Error("Gemini API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.");
    throw new Error(`Gemini API 오류 (${response.status}): ${apiMessage}`);
  }
  const candidate = (payload as JsonRecord).candidates as Array<JsonRecord> | undefined;
  const text = (((candidate?.[0]?.content as JsonRecord | undefined)?.parts as Array<JsonRecord> | undefined)?.find((part) => typeof part.text === "string")?.text as string | undefined) ?? "";
  if (!text) throw new Error("AI가 구조화된 레시피 결과를 반환하지 않았습니다.");
  const usage = (payload as JsonRecord).usageMetadata as JsonRecord | undefined;
  return { text, inputTokens: Number(usage?.promptTokenCount ?? 0), outputTokens: Number(usage?.candidatesTokenCount ?? 0) };
}

function buildPrompt(sourceType: SourceType, manifest: ImportManifest | undefined) {
  const header = `당신은 한국 식음료 매장의 레시피 표를 정규화하는 데이터 추출기입니다.\n` +
    `파일 형식: ${sourceType}. 표 양식은 매장마다 다르므로 열 이름을 가정하지 말고 메뉴명, 재료명, 원래 사용량, 기준 생산량을 문맥으로 찾으세요.\n` +
    `반드시 JSON만 반환하고 설명/마크다운은 쓰지 마세요. 모호한 값은 추측하지 말고 warnings에 기록하세요.\n` +
    `수량은 메뉴 1개 기준 quantity_per_item으로 환산하세요. 환산할 수 없으면 원래 수량을 유지하고 warnings에 '기준 생산량 확인 필요'를 넣으세요. 단위는 g, kg, ml, L, 개 중 하나만 사용하세요.`;
  if (sourceType === "pdf") return `${header}\nPDF의 모든 페이지를 읽고 같은 메뉴가 여러 페이지에 이어지면 하나로 합치세요.`;
  const compactManifest = manifest ? JSON.stringify(manifest) : "{}";
  return `${header}\n아래는 스프레드시트에서 읽은 셀/병합 정보입니다. 빈 셀과 반복 헤더를 무시하고 메뉴 단위로 묶으세요.\n${compactManifest}`;
}

function recipeSchema() {
  return {
    type: "object",
    properties: {
      menus: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source_key: { type: "string" }, name: { type: "string" }, sort_order: { type: "number" }, yield_quantity: { type: "number" }, yield_unit: { type: "string" }, confidence: { type: "number" }, warnings: { type: "array", items: { type: "string" } }, source_refs: { type: "array", items: { type: "string" } },
            ingredients: { type: "array", items: { type: "object", properties: { source_name: { type: "string" }, source_quantity: { type: "number" }, source_unit: { type: "string" }, quantity_per_item: { type: "number" }, quantity_unit: { type: "string", enum: ["g", "kg", "ml", "L", "개"] }, confidence: { type: "number" }, warnings: { type: "array", items: { type: "string" } }, source_refs: { type: "array", items: { type: "string" } } }, required: ["source_name", "quantity_per_item", "quantity_unit"] } }
          },
          required: ["name", "ingredients"]
        }
      }
    },
    required: ["menus"]
  };
}

function parseExtraction(rawText: string) {
  const cleaned = rawText.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as JsonRecord;
  return { menus: Array.isArray(parsed.menus) ? parsed.menus as ExtractedMenu[] : [] };
}

function normalizeMenus(rawMenus: ExtractedMenu[], products: Array<{ id: string; name: string; barcode: string | null }>, aliases: Array<{ alias_normalized: string; product_id: string }>) {
  return rawMenus.map((rawMenu, menuIndex) => {
    const name = textValue(rawMenu.name);
    const rawIngredients = Array.isArray(rawMenu.ingredients) ? rawMenu.ingredients as ExtractedIngredient[] : [];
    const yieldQuantity = positiveNumber(rawMenu.yield_quantity);
    const ingredients = rawIngredients.map((rawIngredient) => {
      const sourceName = textValue(rawIngredient.source_name);
      const sourceQuantity = positiveNumber(rawIngredient.source_quantity);
      const quantityPerItem = positiveNumber(rawIngredient.quantity_per_item) ?? (sourceQuantity && yieldQuantity ? sourceQuantity / yieldQuantity : null);
      const unit = normalizeUnit(rawIngredient.quantity_unit ?? rawIngredient.source_unit);
      const product = findProduct(sourceName, products, aliases);
      const warnings = stringArray(rawIngredient.warnings);
      if (!quantityPerItem) warnings.push("사용량 확인 필요");
      return {
        source_name: sourceName || "이름 미확인 재료",
        source_quantity: sourceQuantity,
        source_unit: textValue(rawIngredient.source_unit) || null,
        quantity_per_item: Number((quantityPerItem ?? 1).toFixed(4)),
        quantity_unit: unit,
        product_id: product?.id ?? null,
        ingredient_name: product ? null : sourceName || "이름 미확인 재료",
        source_refs: jsonArray(rawIngredient.source_refs),
        candidates: product ? [] : products.filter((item) => normalizeName(item.name).includes(normalizeName(sourceName))).slice(0, 5).map((item) => ({ product_id: item.id, name: item.name })),
        warnings,
        confidence: boundedNumber(rawIngredient.confidence),
        match_status: quantityPerItem ? (product ? "matched" : "temporary") : "review"
      };
    }).filter((ingredient) => ingredient.quantity_per_item > 0);
    return {
      source_key: textValue(rawMenu.source_key) || `menu-${menuIndex + 1}`,
      name: name || `가져온 메뉴 ${menuIndex + 1}`,
      sort_order: Math.max(1, Math.trunc(positiveNumber(rawMenu.sort_order) ?? menuIndex + 1)),
      yield_quantity: yieldQuantity,
      yield_unit: textValue(rawMenu.yield_unit) || null,
      source_refs: jsonArray(rawMenu.source_refs),
      warnings: stringArray(rawMenu.warnings),
      confidence: boundedNumber(rawMenu.confidence),
      ingredients
    };
  }).filter((menu) => menu.ingredients.length > 0);
}

function findProduct(name: string, products: Array<{ id: string; name: string; barcode: string | null }>, aliases: Array<{ alias_normalized: string; product_id: string }>) {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  const alias = aliases.find((item) => item.alias_normalized === normalized);
  if (alias) return products.find((product) => product.id === alias.product_id);
  return products.find((product) => normalizeName(product.name) === normalized || normalizeName(product.barcode ?? "") === normalized);
}

function normalizeName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s()[\]{}<>·•]/g, "");
}

function normalizeUnit(value: unknown): "g" | "kg" | "ml" | "L" | "개" {
  const normalized = textValue(value).toLowerCase().replace(/\s/g, "");
  if (["kg", "킬로", "킬로그램"].includes(normalized)) return "kg";
  if (["ml", "밀리", "밀리리터"].includes(normalized)) return "ml";
  if (["l", "리터"].includes(normalized)) return "L";
  if (["개", "ea", "pcs", "개입"].includes(normalized)) return "개";
  return "g";
}

function textValue(value: unknown) { return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim(); }
function positiveNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function boundedNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.map(textValue).filter(Boolean) : []; }
function jsonArray(value: unknown) { return Array.isArray(value) ? value : []; }
function calculateCost(inputTokens: number, outputTokens: number) { return Number(((inputTokens * INPUT_PRICE_PER_MILLION + outputTokens * OUTPUT_PRICE_PER_MILLION) / 1_000_000).toFixed(6)); }
function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function isManifest(value: unknown): value is ImportManifest { return Boolean(value && typeof value === "object" && "sourceType" in value); }
function normalizeModel(value: string) { return value.trim().replace(/^models\//, "") || DEFAULT_MODEL; }

async function failJob(adminClient: ReturnType<typeof createClient>, jobId: string, message: string, status = "failed") {
  await adminClient.from("recipe_import_jobs").update({ status, error_message: message }).eq("id", jobId);
  return jsonResponse({ error: message, status }, status === "failed" ? 500 : 200);
}

async function cleanupExpiredSources(supabaseUrl: string, serviceRoleKey: string, req: Request) {
  const secret = Deno.env.get("RECIPE_IMPORT_CLEANUP_SECRET");
  if (!secret || req.headers.get("x-cleanup-secret") !== secret) return jsonResponse({ error: "정리 작업 인증이 필요합니다." }, 401);
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: jobs } = await adminClient.from("recipe_import_jobs").select("id,storage_path").not("storage_path", "is", null).lt("source_expires_at", new Date().toISOString()).limit(100);
  let deleted = 0;
  for (const job of jobs ?? []) {
    if (job.storage_path) await adminClient.storage.from("recipe-imports").remove([job.storage_path]);
    await adminClient.from("recipe_import_jobs").update({ storage_path: null }).eq("id", job.id);
    deleted += 1;
  }
  return jsonResponse({ ok: true, deleted });
}

function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
