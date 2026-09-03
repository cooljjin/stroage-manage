import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { PageTitle } from "../../../src/components/PageTitle";
import { StatusMessage } from "../../../src/components/StatusMessage";
import * as Services from "../../../src/services";
import type { StaffProfile, Store } from "../../../src/types/domain";
import type { Database } from "../../../src/types/supabase";

type ExtraUseRequest = Database["public"]["Tables"]["recipe_import_extra_use_requests"]["Row"];
type RecipeImportJob = Database["public"]["Tables"]["recipe_import_jobs"]["Row"];

export function MasterRecipeApprovalsPage() {
  const [requests, setRequests] = useState<ExtraUseRequest[]>([]);
  const [jobs, setJobs] = useState<RecipeImportJob[]>([]);
  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [grantCounts, setGrantCounts] = useState<Record<string, string>>({});
  const [requestReasons, setRequestReasons] = useState<Record<string, string>>({});
  const [costAmounts, setCostAmounts] = useState<Record<string, string>>({});
  const [costReasons, setCostReasons] = useState<Record<string, string>>({});
  const [manualUserId, setManualUserId] = useState("");
  const [manualUses, setManualUses] = useState("1");
  const [manualReason, setManualReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );
  const storeById = useMemo(
    () => new Map(stores.map((store) => [store.id, store])),
    [stores]
  );

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError("");
    const [requestResult, jobResult, profileResult, storeResult] = await Promise.all([
      Services.DatabaseService.select("recipe_import_extra_use_requests", "*", {
        filters: [{ column: "status", operator: "eq", value: "pending" }],
        order: [{ column: "created_at", ascending: true }]
      }),
      Services.DatabaseService.select("recipe_import_jobs", "*", {
        filters: [{ column: "status", operator: "eq", value: "awaiting_cost_approval" }],
        order: [{ column: "created_at", ascending: true }]
      }),
      Services.DatabaseService.rpc("list_store_staff_admin"),
      Services.DatabaseService.select("stores", "*").order("name", { ascending: true })
    ]);

    const firstError = requestResult.error ?? jobResult.error ?? profileResult.error ?? storeResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const nextRequests = (requestResult.data ?? []) as ExtraUseRequest[];
    const nextJobs = (jobResult.data ?? []) as RecipeImportJob[];
    const nextProfiles = (profileResult.data ?? []) as StaffProfile[];
    setRequests(nextRequests);
    setJobs(nextJobs);
    setProfiles(nextProfiles);
    setStores((storeResult.data ?? []) as Store[]);
    setManualUserId((current) => current || nextProfiles.find((profile) => profile.role !== "master")?.id || "");
    setGrantCounts(Object.fromEntries(nextRequests.map((request) => [request.id, String(request.requested_uses)])));
    setCostAmounts(Object.fromEntries(nextJobs.map((job) => [job.id, String(Math.max(Number(job.estimated_cost_usd), Number(job.actual_cost_usd), 0.5001))])));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  async function approveRequest(request: ExtraUseRequest) {
    const additionalUses = Number(grantCounts[request.id] ?? request.requested_uses);
    const reason = requestReasons[request.id]?.trim();
    if (!Number.isInteger(additionalUses) || additionalUses < 1 || additionalUses > 20 || !reason) {
      setError("승인 횟수(1~20회)와 승인 사유를 확인해 주세요.");
      return;
    }

    setBusyKey(`request-${request.id}`);
    setError("");
    setMessage("");
    const result = await Services.DatabaseService.rpc("grant_recipe_import_extra_uses", {
      target_user_id: request.user_id,
      target_week_start: request.week_start,
      additional_uses: additionalUses,
      reason,
      target_request_id: request.id
    });
    if (result.error) setError(result.error.message);
    else {
      setMessage(`${profileById.get(request.user_id)?.display_name ?? "사용자"}에게 이번 주 ${additionalUses}회를 추가했습니다.`);
      await loadApprovals();
    }
    setBusyKey("");
  }

  async function rejectRequest(request: ExtraUseRequest) {
    const reason = requestReasons[request.id]?.trim();
    if (!reason) {
      setError("반려 사유를 입력해 주세요.");
      return;
    }

    setBusyKey(`request-${request.id}`);
    setError("");
    setMessage("");
    const result = await Services.DatabaseService.rpc("reject_recipe_import_extra_use_request", {
      target_request_id: request.id,
      reason
    });
    if (result.error) setError(result.error.message);
    else {
      setMessage("추가 이용 요청을 반려했습니다.");
      await loadApprovals();
    }
    setBusyKey("");
  }

  async function grantManualUses() {
    const additionalUses = Number(manualUses);
    if (!manualUserId || !Number.isInteger(additionalUses) || additionalUses < 1 || additionalUses > 20 || !manualReason.trim()) {
      setError("대상 사용자, 추가 횟수(1~20회), 승인 사유를 확인해 주세요.");
      return;
    }

    setBusyKey("manual-grant");
    setError("");
    setMessage("");
    const result = await Services.DatabaseService.rpc("grant_recipe_import_extra_uses", {
      target_user_id: manualUserId,
      target_week_start: new Date().toISOString().slice(0, 10),
      additional_uses: additionalUses,
      reason: manualReason.trim(),
      target_request_id: null
    });
    if (result.error) setError(result.error.message);
    else {
      setMessage("이번 주 추가 이용 횟수를 부여했습니다.");
      setManualReason("");
      await loadApprovals();
    }
    setBusyKey("");
  }

  async function approveCost(job: RecipeImportJob) {
    const approvedCost = Number(costAmounts[job.id]);
    const requiredCost = Math.max(Number(job.estimated_cost_usd), Number(job.actual_cost_usd));
    const reason = costReasons[job.id]?.trim();
    if (!Number.isFinite(approvedCost) || approvedCost <= 0.5 || approvedCost > 5 || approvedCost < requiredCost || !reason) {
      setError("허용 범위 안의 확인값과 사유를 입력해 주세요.");
      return;
    }

    setBusyKey(`cost-${job.id}`);
    setError("");
    setMessage("");
    const approvalResult = await Services.DatabaseService.rpc("approve_recipe_import_cost", {
      target_job_id: job.id,
      target_approved_cost_usd: approvedCost,
      reason
    });
    if (approvalResult.error) {
      setError(approvalResult.error.message);
      setBusyKey("");
      return;
    }

    const jobResult = await Services.DatabaseService.select("recipe_import_jobs", "*", {
      filters: [{ column: "id", operator: "eq", value: job.id }],
      single: true
    });
    if (jobResult.error) {
      setError(jobResult.error.message);
      setBusyKey("");
      return;
    }

    const approvedJob = jobResult.data as RecipeImportJob;
    if (approvedJob.status === "queued") {
      const processResult = await Services.EdgeFunctionService.invoke("recipe-import", {
        body: { action: "process", jobId: job.id }
      });
      if (processResult.error) {
        setError(`관리자 확인은 저장했지만 분석 시작에 실패했습니다: ${processResult.error.message}`);
        setBusyKey("");
        await loadApprovals();
        return;
      }
    }

    setMessage(approvedJob.status === "queued" ? "관리자 확인 후 분석을 시작했습니다." : "관리자 확인을 반영했습니다.");
    await loadApprovals();
    setBusyKey("");
  }

  return (
    <section>
      <PageTitle
        title="AI 분석 승인"
        description="주간 추가 횟수와 추가 확인이 필요한 작업을 master가 사유와 함께 검토합니다."
        action={<button type="button" className="secondary-button inline-flex items-center gap-2" onClick={() => void loadApprovals()} disabled={loading}><RefreshCw size={17} className={loading ? "animate-spin" : undefined} />새로고침</button>}
      />

      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}
      {loading ? <StatusMessage>승인 대상을 불러오는 중...</StatusMessage> : null}

      {!loading ? (
        <div className="space-y-5">
          <section className="panel p-4">
            <h2 className="font-black">요청 없이 주간 횟수 부여</h2>
            <p className="mt-1 text-sm text-slate-500">사용자별 이번 주 추가 승인 합계는 최대 20회입니다.</p>
            <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_120px_minmax(240px,2fr)_auto] lg:items-end">
              <label><span className="mb-1 block text-xs font-semibold">대상 사용자</span><select className="field" value={manualUserId} onChange={(event) => setManualUserId(event.target.value)}><option value="">사용자 선택</option>{profiles.filter((profile) => profile.role !== "master").map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name} · {storeById.get(profile.store_id)?.name ?? "매장 미지정"}</option>)}</select></label>
              <label><span className="mb-1 block text-xs font-semibold">추가 횟수</span><input className="field" type="number" min="1" max="20" step="1" value={manualUses} onChange={(event) => setManualUses(event.target.value)} /></label>
              <label><span className="mb-1 block text-xs font-semibold">승인 사유</span><input className="field" maxLength={500} value={manualReason} onChange={(event) => setManualReason(event.target.value)} /></label>
              <button type="button" className="primary-button" onClick={() => void grantManualUses()} disabled={busyKey === "manual-grant"}>{busyKey === "manual-grant" ? "저장 중..." : "횟수 부여"}</button>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">추가 이용 요청 <span className="text-brand-600">{requests.length}</span></h2>
            {requests.length === 0 ? <StatusMessage>검토할 추가 이용 요청이 없습니다.</StatusMessage> : (
              <div className="space-y-3">{requests.map((request) => {
                const profile = profileById.get(request.user_id);
                const isBusy = busyKey === `request-${request.id}`;
                return <article key={request.id} className="panel p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{profile?.display_name ?? request.user_id}</p><p className="text-xs text-slate-500">{storeById.get(request.store_id)?.name ?? request.store_id} · 주간 기준 {request.week_start}</p><p className="mt-2 text-sm">{request.reason}</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">요청 {request.requested_uses}회</span></div><div className="mt-3 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_auto_auto] sm:items-end"><label><span className="mb-1 block text-xs font-semibold">승인 횟수</span><input className="field" type="number" min="1" max="20" step="1" value={grantCounts[request.id] ?? request.requested_uses} onChange={(event) => setGrantCounts((current) => ({ ...current, [request.id]: event.target.value }))} /></label><label><span className="mb-1 block text-xs font-semibold">승인·반려 사유</span><input className="field" maxLength={500} value={requestReasons[request.id] ?? ""} onChange={(event) => setRequestReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></label><button type="button" className="primary-button inline-flex items-center justify-center gap-2" onClick={() => void approveRequest(request)} disabled={isBusy}>{isBusy ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />}승인</button><button type="button" className="secondary-button inline-flex items-center justify-center gap-2" onClick={() => void rejectRequest(request)} disabled={isBusy}><X size={16} />반려</button></div></article>;
              })}</div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">추가 확인 작업 <span className="text-brand-600">{jobs.length}</span></h2>
            {jobs.length === 0 ? <StatusMessage>추가 확인이 필요한 대기 작업이 없습니다.</StatusMessage> : (
              <div className="space-y-3">{jobs.map((job) => {
                const profile = job.created_by ? profileById.get(job.created_by) : null;
                const isBusy = busyKey === `cost-${job.id}`;
                return <article key={job.id} className="panel p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{job.file_name}</p><p className="text-xs text-slate-500">{profile?.display_name ?? job.created_by ?? "탈퇴 사용자"} · {storeById.get(job.store_id)?.name ?? job.store_id}</p><p className="mt-2 text-sm">파일 {job.source_uploaded_at ? "업로드 완료" : "업로드 대기"}</p>{job.error_message ? <p className="mt-1 text-xs font-semibold text-rose-700">{job.error_message}</p> : null}</div><ShieldCheck className="text-brand-600" size={24} /></div><div className="mt-3 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-end"><label><span className="mb-1 block text-xs font-semibold">확인값</span><input className="field" type="number" min={Math.max(Number(job.estimated_cost_usd), Number(job.actual_cost_usd), 0.5001)} max="5" step="0.0001" value={costAmounts[job.id] ?? ""} onChange={(event) => setCostAmounts((current) => ({ ...current, [job.id]: event.target.value }))} /></label><label><span className="mb-1 block text-xs font-semibold">확인 사유</span><input className="field" maxLength={500} value={costReasons[job.id] ?? ""} onChange={(event) => setCostReasons((current) => ({ ...current, [job.id]: event.target.value }))} /></label><button type="button" className="primary-button inline-flex items-center justify-center gap-2" onClick={() => void approveCost(job)} disabled={isBusy}>{isBusy ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />}확인</button></div></article>;
              })}</div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
