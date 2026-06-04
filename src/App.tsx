import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Moon, Sun } from "lucide-react";
import { BottomNav } from "./components/BottomNav";
import { OfflineBanner } from "./components/OfflineBanner";
import { TopMenu } from "./components/TopMenu";
import { LoginPage } from "./pages/LoginPage";
import { ScanPage } from "./pages/ScanPage";
import { ProductRegisterPage } from "./pages/ProductRegisterPage";
import { InventoryOperationPage } from "./pages/InventoryOperationPage";
import { InventoryListPage } from "./pages/InventoryListPage";
import { LowStockPage } from "./pages/LowStockPage";
import { LogsPage } from "./pages/LogsPage";
import { ProductManagementPage } from "./pages/ProductManagementPage";
import { CategoryManagementPage } from "./pages/CategoryManagementPage";
import { DARK_MODE_STORAGE_KEY } from "./lib/constants";
import { supabase } from "./lib/supabase";
import type { AppRoute, RouteName } from "./types/domain";

const NAV_ROUTES: RouteName[] = ["scan", "inventory", "low-stock", "logs"];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [route, setRoute] = useState<AppRoute>({ name: "scan" });
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(DARK_MODE_STORAGE_KEY) === "true");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(darkMode));
  }, [darkMode]);

  const activeRoute = useMemo<RouteName>(() => {
    return NAV_ROUTES.includes(route.name) ? route.name : "scan";
  }, [route.name]);

  function navigate(next: AppRoute) {
    setMenuOpen(false);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setRoute({ name: "scan" });
  }

  if (authLoading) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">로딩 중...</div>;
  }

  if (!session) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-24 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <OfflineBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <TopMenu open={menuOpen} onOpenChange={setMenuOpen} onNavigate={(name) => navigate({ name })} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-700 dark:text-brand-100">매장 재고관리</p>
              <p className="max-w-[220px] truncate text-sm text-slate-500 dark:text-slate-400">{session.user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode((value) => !value)}
              className="touch-button icon-button"
              aria-label="다크모드 전환"
              title="다크모드"
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button type="button" onClick={handleLogout} className="touch-button rounded-md border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4">
        {route.name === "scan" && <ScanPage navigate={navigate} />}
        {route.name === "register" && <ProductRegisterPage barcode={route.barcode ?? ""} navigate={navigate} />}
        {route.name === "operation" && <InventoryOperationPage productId={route.productId ?? ""} navigate={navigate} />}
        {route.name === "inventory" && <InventoryListPage navigate={navigate} />}
        {route.name === "low-stock" && <LowStockPage navigate={navigate} />}
        {route.name === "logs" && <LogsPage />}
        {route.name === "product-management" && <ProductManagementPage navigate={navigate} />}
        {route.name === "category-management" && <CategoryManagementPage />}
      </main>

      <BottomNav activeRoute={activeRoute} onNavigate={(name) => navigate({ name })} />
    </div>
  );
}
