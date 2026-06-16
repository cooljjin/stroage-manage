import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Moon, Shield, Sun } from "lucide-react";
import { BottomNav } from "./components/BottomNav";
import { OfflineBanner } from "./components/OfflineBanner";
import { TopMenu } from "./components/TopMenu";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupRequestPage } from "./pages/SignupRequestPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { HomePage } from "./pages/HomePage";
import { ScanPage } from "./pages/ScanPage";
import { ProductRegisterPage } from "./pages/ProductRegisterPage";
import { ProductEditPage } from "./pages/ProductEditPage";
import { InventoryOperationPage } from "./pages/InventoryOperationPage";
import { InventoryListPage } from "./pages/InventoryListPage";
import { LowStockPage } from "./pages/LowStockPage";
import { StatusItemsPage } from "./pages/StatusItemsPage";
import { LogsPage } from "./pages/LogsPage";
import { ProductManagementPage } from "./pages/ProductManagementPage";
import { CategoryManagementPage } from "./pages/CategoryManagementPage";
import { SupplierManagementPage } from "./pages/SupplierManagementPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";
import { StaffManagementPage } from "./pages/StaffManagementPage";
import { MasterStoresPage } from "./pages/MasterStoresPage";
import { MasterUsersPage } from "./pages/MasterUsersPage";
import { DARK_MODE_STORAGE_KEY } from "./lib/constants";
import { ensureCurrentProfile } from "./lib/profiles";
import { supabase } from "./lib/supabase";
import type { AppRoute, RouteName, StaffProfile } from "./types/domain";
import type { ProfileRole } from "./types/domain";

const NAV_ROUTES: RouteName[] = ["home", "scan", "inventory", "low-stock", "logs"];

function initialRoute(): AppRoute {
  const inviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/);
  const inviteParam = new URLSearchParams(window.location.search).get("invite");

  if (inviteMatch?.[1]) {
    return { name: "invite-accept", inviteToken: decodeURIComponent(inviteMatch[1]) };
  }

  if (inviteParam) {
    return { name: "invite-accept", inviteToken: inviteParam };
  }

  return { name: "landing" };
}

function getProfileRole(profile: StaffProfile): ProfileRole {
  return profile.role ?? (profile.is_admin ? "store_admin" : "staff");
}

function canAccess(routeName: RouteName, profile: StaffProfile) {
  const role = getProfileRole(profile);
  if (role === "master") return true;

  const masterRoutes: RouteName[] = ["master-stores", "master-store-detail", "master-users"];
  if (masterRoutes.includes(routeName)) return false;

  const adminRoutes: RouteName[] = ["admin", "product-management", "category-management", "supplier-management", "settings", "staff-management"];
  if (adminRoutes.includes(routeName)) return role === "store_admin";

  return true;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [route, setRoute] = useState<AppRoute>(() => initialRoute());
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
    if (!session) {
      setProfile(null);
      return;
    }

    ensureCurrentProfile(session).then(setProfile);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (route.name === "landing" || route.name === "login" || route.name === "signup-request") {
      navigate({ name: "home" });
    }
  }, [session, route.name]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(darkMode));
  }, [darkMode]);

  const activeRoute = useMemo<RouteName>(() => {
    return NAV_ROUTES.includes(route.name) ? route.name : "home";
  }, [route.name]);

  function navigate(next: AppRoute) {
    setMenuOpen(false);
    setRoute(next);
    if (next.name === "invite-accept" && next.inviteToken) {
      window.history.replaceState(null, "", `/invite/${encodeURIComponent(next.inviteToken)}`);
    } else {
      window.history.replaceState(null, "", "/");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ name: "landing" });
  }

  if (authLoading) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">로딩 중...</div>;
  }

  if (!session) {
    if (route.name === "login") {
      return <LoginPage />;
    }

    if (route.name === "signup-request") {
      return <SignupRequestPage onBack={() => navigate({ name: "landing" })} />;
    }

    if (route.name === "invite-accept" && route.inviteToken) {
      return <InviteAcceptPage token={route.inviteToken} signedIn={false} onLogin={() => navigate({ name: "login" })} onAccepted={setProfile} />;
    }

    return <LandingPage onLogin={() => navigate({ name: "login" })} onSignupRequest={() => navigate({ name: "signup-request" })} />;
  }

  if (route.name === "invite-accept" && route.inviteToken) {
    return (
      <InviteAcceptPage
        token={route.inviteToken}
        signedIn={true}
        onLogin={() => navigate({ name: "login" })}
        onAccepted={(nextProfile) => {
          setProfile(nextProfile);
          navigate({ name: "home" });
        }}
      />
    );
  }

  if (!profile) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 px-4 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
        <div className="panel max-w-sm p-5 text-center">
          <p className="text-lg font-bold">매장 연결이 필요합니다.</p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">관리자가 보낸 초대 링크로 접속해 계정을 매장에 연결해 주세요.</p>
          <button type="button" onClick={handleLogout} className="secondary-button mt-4 w-full">
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  const permittedRoute = canAccess(route.name, profile) ? route : { name: "home" as const };
  const profileRole = getProfileRole(profile);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-slate-50 pb-24 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <OfflineBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl min-w-0 items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <TopMenu open={menuOpen} role={profileRole} onOpenChange={setMenuOpen} onNavigate={(name) => navigate({ name })} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-700 dark:text-brand-100">매장 재고관리</p>
              <p className="max-w-[220px] truncate text-sm text-slate-500 dark:text-slate-400">{session.user.email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {profileRole !== "staff" ? (
              <button
                type="button"
                onClick={() => navigate({ name: profileRole === "master" ? "master-stores" : "staff-management" })}
                className="touch-button inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-brand-600 px-2 text-sm font-bold text-brand-700 dark:text-brand-100 sm:px-3"
              >
                <Shield size={18} />
                <span className="hidden sm:inline">{profileRole === "master" ? "마스터 페이지" : "관리자 페이지"}</span>
                <span className="sm:hidden">{profileRole === "master" ? "마스터" : "관리자"}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDarkMode((value) => !value)}
              className="touch-button icon-button"
              aria-label="다크모드 전환"
              title="다크모드"
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button type="button" onClick={handleLogout} className="touch-button whitespace-nowrap rounded-md border border-slate-300 px-2 text-sm font-semibold dark:border-slate-700 sm:px-3">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto min-w-0 max-w-6xl px-4 py-4">
        {permittedRoute.name === "home" && <HomePage navigate={navigate} />}
        {permittedRoute.name === "scan" && <ScanPage navigate={navigate} />}
        {permittedRoute.name === "register" && <ProductRegisterPage barcode={permittedRoute.barcode ?? ""} navigate={navigate} />}
        {permittedRoute.name === "product-edit" && <ProductEditPage productId={permittedRoute.productId ?? ""} navigate={navigate} />}
        {permittedRoute.name === "operation" && <InventoryOperationPage productId={permittedRoute.productId ?? ""} navigate={navigate} />}
        {permittedRoute.name === "inventory" && <InventoryListPage navigate={navigate} />}
        {permittedRoute.name === "low-stock" && <LowStockPage navigate={navigate} />}
        {permittedRoute.name === "status-items" && <StatusItemsPage navigate={navigate} />}
        {permittedRoute.name === "logs" && <LogsPage navigate={navigate} />}
        {permittedRoute.name === "product-management" && <ProductManagementPage navigate={navigate} />}
        {permittedRoute.name === "category-management" && <CategoryManagementPage />}
        {permittedRoute.name === "supplier-management" && <SupplierManagementPage />}
        {permittedRoute.name === "settings" && <SettingsPage />}
        {permittedRoute.name === "staff-management" && <StaffManagementPage />}
        {permittedRoute.name === "master-stores" && <MasterStoresPage />}
        {permittedRoute.name === "master-users" && <MasterUsersPage />}
        {permittedRoute.name === "admin" && <AdminPage />}
      </main>

      <BottomNav activeRoute={activeRoute} onNavigate={(name) => navigate({ name })} />
    </div>
  );
}
