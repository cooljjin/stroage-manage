import { FormEvent, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { supabase } from "../lib/supabase";
import type { Store } from "../types/domain";

export function MasterStoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadStores();
  }, []);

  async function loadStores() {
    setLoading(true);
    setError("");

    const { data, error: loadError } = await supabase
      .from("stores")
      .select("*")
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setStores(data ?? []);
    }

    setLoading(false);
  }

  async function createStore(event: FormEvent) {
    event.preventDefault();

    const name = storeName.trim();
    if (!name) {
      setError("매장 이름을 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const { error: insertError } = await supabase.from("stores").insert({ name });

    if (insertError) {
      setError(insertError.message);
    } else {
      setStoreName("");
      setMessage("새 매장을 생성했습니다.");
      await loadStores();
    }

    setSaving(false);
  }

  return (
    <section>
      <PageTitle title="전체 매장" description="마스터 계정에서 매장을 생성하고 확인합니다." />

      <form onSubmit={createStore} className="panel mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">매장 이름</span>
          <input
            className="field"
            value={storeName}
            onChange={(event) => setStoreName(event.target.value)}
            placeholder="예: 강남점"
            required
          />
        </label>
        <button type="submit" className="primary-button inline-flex items-center justify-center gap-2" disabled={saving}>
          <Plus size={18} />
          {saving ? "생성 중..." : "매장 생성"}
        </button>
      </form>

      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}
      {loading ? <StatusMessage>매장 목록을 불러오는 중...</StatusMessage> : null}

      {!loading ? (
        <div className="panel overflow-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="px-3 py-3">매장 이름</th>
                <th className="w-24 px-3 py-3">상태</th>
                <th className="hidden w-44 px-3 py-3 sm:table-cell">생성일</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="px-3 py-3">
                    <span className="block truncate font-bold">{store.name}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{store.id}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded bg-brand-100 px-2 py-1 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-100">
                      {store.status === "active" ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="hidden px-3 py-3 text-xs text-slate-500 dark:text-slate-400 sm:table-cell">
                    {new Date(store.created_at).toLocaleDateString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stores.length === 0 ? <div className="p-4"><StatusMessage>등록된 매장이 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}
    </section>
  );
}
