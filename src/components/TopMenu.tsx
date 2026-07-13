import { Calculator, ClipboardCheck, CookingPot, Menu, Package, Settings, Store, Tags, Truck, Users, X } from "lucide-react";
import type { ProfileRole, RouteName } from "../types/domain";

type Props = {
  open: boolean;
  role: ProfileRole;
  onOpenChange: (open: boolean) => void;
  onNavigate: (route: RouteName) => void;
};

export function TopMenu({ open, role, onOpenChange, onNavigate }: Props) {
  function go(route: RouteName) {
    onNavigate(route);
    onOpenChange(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="touch-button icon-button"
        aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
        title="메뉴"
      >
        {open ? <X size={21} /> : <Menu size={21} />}
      </button>

      {open ? (
        <div className="absolute left-0 top-12 z-50 max-h-[calc(100dvh-8rem)] w-56 touch-pan-y overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white p-2 shadow-soft [-webkit-overflow-scrolling:touch] dark:border-slate-800 dark:bg-slate-950">
          {role === "master" ? (
            <>
              <button
                type="button"
                onClick={() => go("master-stores")}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <Store size={19} />
                전체 매장
              </button>
              <button
                type="button"
                onClick={() => go("master-users")}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <Users size={19} />
                전체 사용자
              </button>
            </>
          ) : null}
          {role === "master" ? <div className="my-1 border-t border-slate-100 dark:border-slate-800" /> : null}
          <button
            type="button"
            onClick={() => go("prep-mode")}
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <CookingPot size={19} />
            프랩관리모드
          </button>
          {role !== "staff" ? (
            <button
              type="button"
              onClick={() => go("prep-items")}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              <CookingPot size={19} />
              프랩품목 관리
            </button>
          ) : null}
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button
            type="button"
            onClick={() => go("group-order")}
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <Calculator size={19} />
            단체주문 계산
          </button>
          {role !== "staff" ? (
            <button
              type="button"
              onClick={() => go("group-order-recipes")}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              <Calculator size={19} />
              메뉴 레시피 등록
            </button>
          ) : null}
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button
            type="button"
            onClick={() => go("status-items")}
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <ClipboardCheck size={19} />
            개별관리 품목
          </button>
          {role !== "staff" ? <div className="my-1 border-t border-slate-100 dark:border-slate-800" /> : null}
          {role !== "staff" ? (
            <>
              <button
                type="button"
                onClick={() => go("category-management")}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <Tags size={19} />
                카테고리 관리
              </button>
              <button
                type="button"
                onClick={() => go("unit-management")}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <Package size={19} />
                품목 단위 관리
              </button>
              <button
                type="button"
                onClick={() => go("supplier-management")}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <Truck size={19} />
                발주처 관리
              </button>
            </>
          ) : null}
          {role === "store_admin" ? (
            <button
              type="button"
              onClick={() => go("staff-management")}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              <Users size={19} />
              직원 관리
            </button>
          ) : null}
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button
            type="button"
            onClick={() => go("settings")}
            className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <Settings size={19} />
            환경설정
          </button>
        </div>
      ) : null}
    </div>
  );
}
