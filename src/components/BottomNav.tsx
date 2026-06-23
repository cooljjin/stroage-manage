import { NAV_ITEMS } from "../lib/constants";
import type { RouteName } from "../types/domain";

type Props = {
  activeRoute: RouteName;
  onNavigate: (route: RouteName) => void;
};

export function BottomNav({ activeRoute, onNavigate }: Props) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto grid max-w-3xl grid-cols-6">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.route;
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={`flex min-h-[64px] flex-col items-center justify-center gap-1 text-xs font-semibold ${
                active ? "text-brand-700 dark:text-brand-100" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <Icon size={22} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
