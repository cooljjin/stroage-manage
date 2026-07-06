import { ExternalLink, MessageSquareText } from "lucide-react";
import type { InventoryItem, ProductSupplier } from "../types/domain";

type Props = {
  item: InventoryItem;
  supplier: ProductSupplier | null;
  quantity: string;
  onQuantityChange: (quantity: string) => void;
};

function buildSmsBody(item: InventoryItem, supplier: ProductSupplier, quantity: string) {
  const orderQuantity = quantity.trim();
  const unit = item.unit_name ?? "개";
  const fallbackBody = `안녕하세요! 카페 낙입니다.\n${item.name}\n${orderQuantity}${unit} 부탁드립니다.\n\n감사합니다.`;
  const template = supplier.sms_template?.trim() || fallbackBody;

  return template
    .split("{product}").join(item.name)
    .split("{quantity}").join(orderQuantity)
    .split("{unit}").join(unit);
}

function buildSmsHref(phone: string, body: string) {
  const separator = /iPad|iPhone|iPod/i.test(navigator.userAgent) ? "&" : "?";
  return `sms:${encodeURIComponent(phone)}${separator}body=${encodeURIComponent(body)}`;
}

export function ProductOrderAction({ item, supplier, quantity, onQuantityChange }: Props) {
  const isSmsOrder = supplier?.order_method === "sms";
  const hasProductUrl = Boolean(item.product_url);
  const hasSmsPhone = Boolean(supplier?.sms_phone?.trim());
  const hasQuantity = Boolean(quantity.trim());
  const showQuantityInput = isSmsOrder && hasSmsPhone;
  const disabled = isSmsOrder ? !hasSmsPhone || !hasQuantity : !hasProductUrl;
  const actionLabel = isSmsOrder ? `${item.name} 문자 발주` : `${item.name} 링크 열기`;

  function handleAction() {
    if (isSmsOrder) {
      if (!supplier?.sms_phone) return;
      window.location.href = buildSmsHref(supplier.sms_phone, buildSmsBody(item, supplier, quantity));
      return;
    }

    if (item.product_url) {
      window.open(item.product_url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <span className={`mx-auto grid min-w-0 items-center gap-1 ${showQuantityInput ? "w-full max-w-[92px] grid-cols-[minmax(0,1fr)_2.5rem]" : "w-10 grid-cols-1"}`} onClick={(event) => event.stopPropagation()}>
      {showQuantityInput ? (
        <input
          className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-1 text-center text-sm font-bold tabular-nums text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          inputMode="numeric"
          pattern="[0-9]*"
          value={quantity}
          onChange={(event) => onQuantityChange(event.target.value.replace(/\D/g, ""))}
          placeholder="수량"
          aria-label={`${item.name} 발주 수량`}
        />
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={handleAction}
        className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 text-brand-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-45 dark:border-slate-700 dark:text-brand-200 dark:disabled:text-slate-600"
        aria-label={actionLabel}
        title={isSmsOrder ? "문자 발주" : "링크 열기"}
      >
        {isSmsOrder ? <MessageSquareText size={18} aria-hidden="true" /> : <ExternalLink size={18} aria-hidden="true" />}
      </button>
    </span>
  );
}
