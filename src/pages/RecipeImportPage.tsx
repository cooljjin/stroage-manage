import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, FileSpreadsheet, FileText, LoaderCircle, Upload } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { createMutationRequestId } from "../lib/mutationRequest";
import {
  estimateRecipeImportCost,
  formatRecipeImportCost,
  hashRecipeImportFile,
  normalizeRecipeImportName,
  preflightRecipeImport,
  RECIPE_IMPORT_ACCEPT,
  type RecipeImportEstimate,
  type RecipeImportManifest
} from "../lib/recipeImport";
import * as Services from "../services";
import type { AppRoute, Product, RecipeImportIngredient, RecipeImportJob, RecipeImportMenu } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
  canManageRecipes: boolean;
  jobId?: string;
};

type ExistingMenu = { id: string; name: string; sort_order: number; is_active: boolean };

function asJob(value: unknown) {
  const raw = value as RecipeImportJob;
  return {
    ...raw,
    file_size: Number(raw.file_size),
    estimated_cost_usd: Number(raw.estimated_cost_usd),
    approved_cost_usd: raw.approved_cost_usd === null ? null : Number(raw.approved_cost_usd),
    actual_cost_usd: Number(raw.actual_cost_usd),
    input_tokens: Number(raw.input_tokens),
    output_tokens: Number(raw.output_tokens),
    total_segments: Number(raw.total_segments),
    completed_segments: Number(raw.completed_segments)
  };
}

function asMenu(value: unknown) {
  return value as RecipeImportMenu;
}

function asIngredient(value: unknown) {
  return value as RecipeImportIngredient;
}

function sourceIcon(sourceType?: string) {
  return sourceType === "pdf" ? <FileText size={18} /> : <FileSpreadsheet size={18} />;
}

async function getRecipeImportErrorMessage(cause: unknown, fallback: string) {
  const genericMessage = cause instanceof Error ? cause.message : "";
  const context = typeof cause === "object" && cause !== null && "context" in cause
    ? (cause as { context?: unknown }).context
    : null;

  if (context instanceof Response) {
    const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  }

  return genericMessage && genericMessage !== "Edge Function returned a non-2xx status code"
    ? genericMessage
    : fallback;
}

export function RecipeImportPage({ navigate, currentStoreId, canManageRecipes, jobId: initialJobId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<RecipeImportManifest | null>(null);
  const [estimate, setEstimate] = useState<RecipeImportEstimate | null>(null);
  const [job, setJob] = useState<RecipeImportJob | null>(null);
  const [menus, setMenus] = useState<RecipeImportMenu[]>([]);
  const [ingredients, setIngredients] = useState<RecipeImportIngredient[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [existingMenus, setExistingMenus] = useState<ExistingMenu[]>([]);
  const [busy, setBusy] = useState(false);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [approvedCost, setApprovedCost] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refreshJob = useCallback(async (targetJobId: string) => {
    const [jobResult, menusResult, productsResult, existingResult] = await Promise.all([
      Services.DatabaseService.select("recipe_import_jobs", "*", { filters: [{ column: "id", operator: "eq", value: targetJobId }], single: true }),
      Services.DatabaseService.select("recipe_import_menus", "*", { filters: [{ column: "job_id", operator: "eq", value: targetJobId }], order: [{ column: "sort_order" }, { column: "name" }] }),
      Services.DatabaseService.select("products", "id,store_id,name,barcode,is_active,category,supplier_name,storage_type,default_location,unit_name,unit_weight_enabled,unit_weight,unit_weight_unit,processing_required,processed_unit_weight,processed_unit_weight_unit,product_url,order_completed,confirmed_order_pending,urgent_order_requested,urgent_order_quantity,fresh_order_selected,fresh_order_selected_at,receipt_check_only,status_enabled,stock_status,minimum_stock,is_important,created_at", { filters: [{ column: "store_id", operator: "eq", value: currentStoreId }, { column: "is_active", operator: "eq", value: true }], order: [{ column: "name" }] }),
      Services.DatabaseService.select("group_order_menus", "id,name,sort_order,is_active", { filters: [{ column: "store_id", operator: "eq", value: currentStoreId }, { column: "is_active", operator: "eq", value: true }], order: [{ column: "sort_order" }, { column: "name" }] })
    ]);
    if (jobResult.error) throw jobResult.error;
    if (menusResult.error) throw menusResult.error;
    if (productsResult.error) throw productsResult.error;
    if (existingResult.error) throw existingResult.error;

    const nextJob = asJob(jobResult.data);
    const stagedMenus = ((menusResult.data ?? []) as unknown[]).map(asMenu);
    const existingRows = (existingResult.data ?? []) as ExistingMenu[];
    const existingNameMap = new Map<string, ExistingMenu>();
    existingRows.forEach((item) => existingNameMap.set(normalizeRecipeImportName(item.name), item));
    const nextMenus = stagedMenus.map((menu) => {
      const conflict = existingNameMap.get(normalizeRecipeImportName(menu.name));
      return conflict && menu.decision === "create" ? { ...menu, existing_menu_id: conflict.id, review_status: "review" as const } : menu;
    });
    const menuIds = nextMenus.map((menu) => menu.id);
    let nextIngredients: RecipeImportIngredient[] = [];
    if (menuIds.length > 0) {
      const ingredientResult = await Services.DatabaseService.select("recipe_import_ingredients", "*", { filters: [{ column: "import_menu_id", operator: "in", value: menuIds }], order: [{ column: "created_at" }] });
      if (ingredientResult.error) throw ingredientResult.error;
      nextIngredients = ((ingredientResult.data ?? []) as unknown[]).map(asIngredient);
    }
    setJob(nextJob);
    setMenus(nextMenus);
    setIngredients(nextIngredients);
    setProducts((productsResult.data ?? []) as Product[]);
    setExistingMenus(existingRows);
    return nextJob;
  }, [currentStoreId]);

  useEffect(() => {
    if (!initialJobId) return;
    setBusy(true);
    void refreshJob(initialJobId)
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setBusy(false));
  }, [initialJobId, refreshJob]);

  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void refreshJob(job.id).catch((pollError: Error) => setError(pollError.message));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [job, refreshJob]);

  const existingByName = useMemo(() => {
    const map = new Map<string, ExistingMenu[]>();
    for (const menu of existingMenus) {
      const key = normalizeRecipeImportName(menu.name);
      map.set(key, [...(map.get(key) ?? []), menu]);
    }
    return map;
  }, [existingMenus]);

  const fileSelected = async (selectedFile: File | null) => {
    setFile(selectedFile);
    setManifest(null);
    setEstimate(null);
    setError("");
    setMessage("");
    if (!selectedFile) return;
    setPreflightBusy(true);
    try {
      const nextManifest = await preflightRecipeImport(selectedFile);
      setManifest(nextManifest);
      setEstimate(estimateRecipeImportCost(nextManifest));
    } catch (preflightError) {
      setError(preflightError instanceof Error ? preflightError.message : "파일을 읽지 못했습니다.");
      setFile(null);
    } finally {
      setPreflightBusy(false);
    }
  };

  const startImport = async () => {
    if (!file || !manifest || !estimate) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fileHash = await hashRecipeImportFile(file);
      const createResult = await Services.DatabaseService.rpc("create_recipe_import_job", {
        target_store_id: currentStoreId,
        target_source_type: manifest.sourceType,
        target_file_name: file.name,
        target_file_size: file.size,
        target_file_hash: fileHash,
        target_estimated_cost_usd: estimate.estimatedCostUsd
      });
      if (createResult.error) throw createResult.error;
      const createdJob = asJob(createResult.data);
      const approved = Number(approvedCost || estimate.estimatedCostUsd);
      if (!Number.isFinite(approved) || approved < estimate.estimatedCostUsd) {
        throw new Error("예상 비용 이상을 승인 금액으로 입력해 주세요.");
      }
      const approvalResult = await Services.DatabaseService.rpc("approve_recipe_import_job", { target_job_id: createdJob.id, target_approved_cost_usd: approved });
      if (approvalResult.error) throw approvalResult.error;
      const uploadResult = await Services.StorageService.upload("recipe-imports", createdJob.storage_path ?? "", file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadResult.error) throw uploadResult.error;
      const uploadedResult = await Services.DatabaseService.rpc("mark_recipe_import_uploaded", { target_job_id: createdJob.id });
      if (uploadedResult.error) throw uploadedResult.error;
      const processResult = await Services.EdgeFunctionService.invoke("recipe-import", { body: { action: "process", jobId: createdJob.id, manifest } });
      if (processResult.error) throw processResult.error;
      setJob(createdJob);
      setMessage("파일을 업로드했습니다. AI가 레시피를 분석하는 중입니다.");
      navigate({ name: "group-order-recipe-import", recipeImportJobId: createdJob.id });
      await refreshJob(createdJob.id);
    } catch (startError) {
      setError(await getRecipeImportErrorMessage(startError, "가져오기를 시작하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const updateMenu = async (menu: RecipeImportMenu, patch: Partial<RecipeImportMenu>) => {
    const next = { ...menu, ...patch };
    setMenus((current) => current.map((item) => (item.id === menu.id ? next : item)));
    const result = await Services.DatabaseService.update("recipe_import_menus", patch).eq("id", menu.id);
    if (result.error) setError(result.error.message);
  };

  const updateIngredient = async (ingredient: RecipeImportIngredient, productId: string | null) => {
    const product = products.find((item) => item.id === productId);
    const patch = {
      product_id: productId,
      ingredient_name: product ? null : ingredient.ingredient_name ?? ingredient.source_name,
      match_status: product ? "matched" : "temporary"
    } as const;
    setIngredients((current) => current.map((item) => (item.id === ingredient.id ? { ...item, ...patch } : item)));
    const result = await Services.DatabaseService.update("recipe_import_ingredients", patch).eq("id", ingredient.id);
    if (result.error) setError(result.error.message);
    if (productId) {
      const aliasResult = await Services.DatabaseService.rpc("link_recipe_product_alias", { target_store_id: currentStoreId, target_alias: ingredient.source_name, target_product_id: productId, target_unit_context: ingredient.quantity_unit });
      if (aliasResult.error) setError(aliasResult.error.message);
    }
    await refreshMenuReviewStatus(ingredient.import_menu_id, { ...ingredient, ...patch });
  };

  const updateIngredientQuantity = async (ingredient: RecipeImportIngredient, value: string) => {
    const quantity = Number(value.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const patch = { quantity_per_item: Number(quantity.toFixed(4)), match_status: ingredient.match_status === "review" ? (ingredient.product_id ? "matched" : "temporary") : ingredient.match_status } as const;
    setIngredients((current) => current.map((item) => item.id === ingredient.id ? { ...item, ...patch } : item));
    const result = await Services.DatabaseService.update("recipe_import_ingredients", patch).eq("id", ingredient.id);
    if (result.error) setError(result.error.message);
    await refreshMenuReviewStatus(ingredient.import_menu_id, { ...ingredient, ...patch });
  };

  const refreshMenuReviewStatus = async (menuId: string, changedIngredient: RecipeImportIngredient) => {
    const menu = menus.find((item) => item.id === menuId);
    if (!menu) return;
    const menuIngredients = ingredients.filter((item) => item.import_menu_id === menuId).map((item) => item.id === changedIngredient.id ? changedIngredient : item);
    const nextReviewStatus = menuIngredients.every((item) => item.match_status === "matched" || item.match_status === "temporary") ? "ready" : "review";
    setMenus((current) => current.map((item) => item.id === menuId ? { ...item, review_status: nextReviewStatus } : item));
    const menuResult = await Services.DatabaseService.update("recipe_import_menus", { review_status: nextReviewStatus }).eq("id", menuId);
    if (menuResult.error) setError(menuResult.error.message);
  };

  const reviewMenu = async (menu: RecipeImportMenu, decision: RecipeImportMenu["decision"], existingMenuId: string | null) => {
    await updateMenu(menu, {
      decision,
      existing_menu_id: decision === "replace" ? existingMenuId : null,
      review_status: decision === "skip" ? "ready" : menuIngredientsReady(menu.id) ? "ready" : "review"
    });
  };

  const menuIngredientsReady = (menuId: string) => ingredients.filter((ingredient) => ingredient.import_menu_id === menuId).every((ingredient) => ingredient.match_status === "matched" || ingredient.match_status === "temporary");

  const applyImport = async () => {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const result = await Services.DatabaseService.rpc("apply_group_order_recipe_import_idempotent", { target_job_id: job.id, request_id: createMutationRequestId() });
      if (result.error) throw result.error;
      setMessage("레시피를 저장했습니다.");
      navigate({ name: "group-order-recipes" });
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "레시피 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const approveAdditionalCost = async () => {
    if (!job) return;
    const approved = Number(approvedCost || Math.max(job.estimated_cost_usd, job.actual_cost_usd));
    if (!Number.isFinite(approved) || approved < job.actual_cost_usd) {
      setError("실제 사용 비용 이상을 승인 금액으로 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const approvalResult = await Services.DatabaseService.rpc("approve_recipe_import_job", { target_job_id: job.id, target_approved_cost_usd: approved });
      if (approvalResult.error) throw approvalResult.error;
      const processResult = await Services.EdgeFunctionService.invoke("recipe-import", { body: { action: "process", jobId: job.id } });
      if (processResult.error) throw processResult.error;
      await refreshJob(job.id);
      setMessage("추가 비용을 승인하고 분석을 재개했습니다.");
    } catch (approvalError) {
      setError(await getRecipeImportErrorMessage(approvalError, "추가 비용 승인에 실패했습니다."));
    } finally {
      setBusy(false);
    }
  };

  if (!canManageRecipes) return <StatusMessage type="error">현재 계정에는 레시피 가져오기 권한이 없습니다.</StatusMessage>;

  const reviewReady = menus.length > 0 && menus.every((menu) => menu.decision === "skip" || (menu.review_status === "ready" && (menu.decision !== "replace" || Boolean(menu.existing_menu_id))));

  return (
    <div>
      <PageTitle
        title="레시피 자동 가져오기"
        description="매장마다 다른 Excel/PDF 양식을 AI가 읽고, 저장 전에 한 번 검토합니다. 원본 파일은 7일 뒤 자동 삭제됩니다."
        action={<button type="button" className="secondary-button inline-flex items-center gap-2" onClick={() => navigate({ name: "group-order-recipes" })}><ArrowLeft size={16} />레시피 목록</button>}
      />

      {error ? <div className="mb-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-4"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!job ? (
        <section className="panel p-4">
          <div className="mb-4 flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-600 text-white"><Upload size={20} /></div>
            <div>
              <h2 className="font-bold">원본 파일 선택</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">양식을 바꾸거나 열 이름을 맞출 필요가 없습니다. 셀 병합, 여러 시트, PDF 표를 함께 분석합니다.</p>
            </div>
          </div>
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-4 text-center dark:border-slate-700 dark:bg-slate-900">
            <input type="file" accept={RECIPE_IMPORT_ACCEPT} className="sr-only" onChange={(event) => void fileSelected(event.target.files?.[0] ?? null)} disabled={busy || preflightBusy} />
            {preflightBusy ? <LoaderCircle className="animate-spin text-brand-600" size={24} /> : <>{sourceIcon(file ? getSourceFromManifest(manifest) : undefined)}<span className="mt-2 text-sm font-semibold">{file?.name ?? "XLSX · XLS · CSV · PDF 파일을 선택"}</span></>}
            {file ? <span className="mt-1 text-xs text-slate-500">{(file.size / 1024).toFixed(1)}KB</span> : null}
          </label>
          {manifest && estimate ? (
            <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <p className="font-semibold">사전 확인</p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">{manifest.sourceType === "pdf" ? `PDF ${manifest.pageCount ?? 1}페이지` : `${manifest.sheets?.length ?? 0}개 시트 · ${manifest.cellCount ?? 0}개 셀`} · 예상 비용 {formatRecipeImportCost(estimate.estimatedCostUsd)}</p>
              <label className="mt-3 block"><span className="mb-1 block text-xs font-semibold">승인할 최대 비용(USD)</span><input className="field max-w-xs" type="number" min={estimate.estimatedCostUsd} step="0.0001" value={approvedCost || estimate.estimatedCostUsd.toFixed(4)} onChange={(event) => setApprovedCost(event.target.value)} /></label>
              <button type="button" className="primary-button mt-3 inline-flex items-center gap-2" disabled={busy} onClick={() => void startImport()}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Upload size={16} />}비용 승인 후 분석 시작</button>
              <p className="mt-2 text-xs text-slate-500">분석 결과는 자동 저장되지 않으며, 아래 검토 화면에서 한 번 확인한 뒤 저장됩니다.</p>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className="panel mb-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">{sourceIcon(job.source_type)}<span className="font-semibold">{job.file_name}</span></div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800">{statusLabel(job.status)}</span>
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">예상 {formatRecipeImportCost(job.estimated_cost_usd)} · 실제 {formatRecipeImportCost(job.actual_cost_usd)} · 원본 만료 {job.source_expires_at ? new Date(job.source_expires_at).toLocaleDateString("ko-KR") : "7일 후"}</p>
            {job.error_message ? <div className="mt-3"><StatusMessage type="error">{job.error_message}</StatusMessage></div> : null}
            {job.status === "awaiting_cost_approval" ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950"><p className="font-semibold">실제 사용량이 승인 상한을 넘었습니다.</p><div className="mt-2 flex flex-wrap items-end gap-2"><label><span className="mb-1 block text-xs font-semibold">새 최대 비용(USD)</span><input className="field w-36 py-2" type="number" min={job.actual_cost_usd} step="0.0001" value={approvedCost || job.actual_cost_usd.toFixed(4)} onChange={(event) => setApprovedCost(event.target.value)} /></label><button type="button" className="primary-button min-h-10" onClick={() => void approveAdditionalCost()} disabled={busy}>추가 비용 승인</button></div></div> : null}
            {job.status === "processing" || job.status === "queued" ? <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300"><LoaderCircle className="animate-spin" size={16} />AI가 문서 구조와 재료 단위를 분석하는 중입니다.</div> : null}
          </section>
          {menus.length === 0 && !["processing", "queued"].includes(job.status) ? <StatusMessage>분석 결과가 없습니다. 원본 양식이 이미지 PDF라면 텍스트 PDF 또는 더 선명한 파일로 다시 시도해 주세요.</StatusMessage> : null}
          <div className="space-y-4">
            {menus.map((menu) => {
              const menuIngredients = ingredients.filter((ingredient) => ingredient.import_menu_id === menu.id);
              const candidates = existingByName.get(normalizeRecipeImportName(menu.name)) ?? [];
              const selectedExisting = menu.existing_menu_id ?? candidates[0]?.id ?? "";
              return (
                <section className="panel p-4" key={menu.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="font-bold">{menu.name}</p><p className="mt-1 text-xs text-slate-500">신뢰도 {menu.confidence === null ? "-" : `${Math.round(menu.confidence * 100)}%`} · 재료 {menuIngredients.length}개</p></div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select className="field min-w-28 py-2 text-sm" value={menu.decision} onChange={(event) => void reviewMenu(menu, event.target.value as RecipeImportMenu["decision"], selectedExisting || null)}><option value="create">새 메뉴로 추가</option><option value="replace">기존 메뉴 교체</option><option value="skip">건너뛰기</option></select>
                      {menu.decision === "replace" ? <select className="field min-w-40 py-2 text-sm" value={selectedExisting} onChange={(event) => void reviewMenu(menu, "replace", event.target.value || null)}><option value="">교체 대상 선택</option>{candidates.length === 0 ? existingMenus.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${menu.review_status === "ready" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{menu.review_status === "ready" ? "검토 완료" : "검토 필요"}</span>
                    </div>
                  </div>
                  {candidates.length > 0 && menu.decision === "create" ? <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-100">같은 이름의 기존 메뉴가 있습니다. 새 메뉴 추가·기존 메뉴 교체·건너뛰기 중 하나를 선택해 주세요.</p> : null}
                  <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {menuIngredients.map((ingredient) => <IngredientReviewRow key={ingredient.id} ingredient={ingredient} products={products} onChange={(productId) => void updateIngredient(ingredient, productId)} onQuantityChange={(value) => void updateIngredientQuantity(ingredient, value)} />)}
                  </div>
                </section>
              );
            })}
          </div>
          {menus.length > 0 ? <div className="mt-4 flex flex-wrap items-center justify-end gap-2"><button type="button" className="secondary-button" onClick={() => void refreshJob(job.id)} disabled={busy}>새로고침</button><button type="button" className="primary-button inline-flex items-center gap-2" onClick={() => void applyImport()} disabled={busy || !reviewReady || !["ready", "needs_review"].includes(job.status)}><Check size={16} />검토 완료 후 레시피 저장</button></div> : null}
        </>
      )}
    </div>
  );
}

function IngredientReviewRow({ ingredient, products, onChange, onQuantityChange }: { ingredient: RecipeImportIngredient; products: Product[]; onChange: (productId: string | null) => void; onQuantityChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-sm font-semibold">{ingredient.source_name}</p><p className="text-xs text-slate-500">{ingredient.quantity_per_item} {ingredient.quantity_unit} / 1개{ingredient.warnings && Array.isArray(ingredient.warnings) && ingredient.warnings.length > 0 ? ` · ${ingredient.warnings.join(", ")}` : ""}</p></div>
      <div className="flex flex-wrap items-center justify-end gap-2"><div className="flex items-center gap-1"><input className="field w-24 py-2 text-sm" type="number" min="0.0001" step="0.0001" value={ingredient.quantity_per_item} onChange={(event) => onQuantityChange(event.target.value)} aria-label={`${ingredient.source_name} 1개당 사용량`} /><span className="text-xs font-semibold text-slate-500">{ingredient.quantity_unit}/개</span></div><select className="field min-w-48 py-2 text-sm" value={ingredient.product_id ?? ""} onChange={(event) => onChange(event.target.value || null)}><option value="">임시 재료로 사용</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>{ingredient.match_status === "matched" ? <Check className="text-emerald-600" size={18} /> : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">{ingredient.match_status === "review" ? "확인 필요" : "임시"}</span>}</div>
    </div>
  );
}

function statusLabel(status: RecipeImportJob["status"]) {
  const labels: Record<RecipeImportJob["status"], string> = { awaiting_approval: "비용 승인 대기", uploading: "업로드 중", queued: "분석 대기", processing: "분석 중", needs_review: "검토 필요", ready: "저장 가능", awaiting_cost_approval: "비용 승인 필요", applying: "저장 중", completed: "저장 완료", failed: "실패", cancelled: "취소됨" };
  return labels[status];
}

function getSourceFromManifest(manifest: RecipeImportManifest | null) {
  return manifest?.sourceType;
}
