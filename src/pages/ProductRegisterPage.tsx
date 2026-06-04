import { FormEvent, useEffect, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { fallbackCategories, loadCategories } from "../lib/categories";
import type { AppRoute, ProductCategory } from "../types/domain";
import { supabase } from "../lib/supabase";

type Props = {
  barcode: string;
  navigate: (route: AppRoute) => void;
};

export function ProductRegisterPage({ barcode, navigate }: Props) {
  const [name, setName] = useState("");
  const [barcodeValue, setBarcodeValue] = useState(barcode);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [category, setCategory] = useState("기타");
  const [minimumStock, setMinimumStock] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCategories({ activeOnly: true })
      .then((data) => {
        const nextCategories = data.length > 0 ? data : fallbackCategories();
        setCategories(nextCategories);
        setCategory((current) => (nextCategories.some((item) => item.name === current) ? current : nextCategories[0]?.name ?? "기타"));
      })
      .catch(() => {
        const nextCategories = fallbackCategories();
        setCategories(nextCategories);
        setCategory(nextCategories[0]?.name ?? "기타");
      });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const { data, error: insertError } = await supabase
      .from("products")
      .insert({
        name: name.trim(),
        barcode: barcodeValue.trim() || null,
        category,
        minimum_stock: Math.max(0, minimumStock)
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
    } else {
      const { error: inventoryError } = await supabase.from("inventory").insert({ product_id: data.id });
      if (inventoryError) {
        setError(inventoryError.message);
      } else {
        navigate({ name: "operation", productId: data.id });
      }
    }

    setSaving(false);
  }

  return (
    <section>
      <PageTitle title="상품 등록" description="미등록 상품을 등록한 뒤 바로 재고 작업으로 이동합니다." />

      <form onSubmit={handleSubmit} className="panel max-w-2xl p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold">상품명</span>
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">바코드</span>
            <input className="field" value={barcodeValue} onChange={(event) => setBarcodeValue(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">카테고리</span>
            <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">최소 재고</span>
            <input className="field" type="number" min={0} value={minimumStock} onChange={(event) => setMinimumStock(Number(event.target.value))} />
          </label>
        </div>

        {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => navigate({ name: "scan" })} className="secondary-button">
            취소
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="primary-button">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </section>
  );
}
