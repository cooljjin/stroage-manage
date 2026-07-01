import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Moon, Shield, Sun } from "lucide-react";
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
import { GroupOrderCalculatorPage } from "./pages/GroupOrderCalculatorPage";
import { PrepItemManagementPage } from "./pages/PrepItemManagementPage";
import { PrepModePage } from "./pages/PrepModePage";
import { CategoryManagementPage } from "./pages/CategoryManagementPage";
import { ProductUnitManagementPage } from "./pages/ProductUnitManagementPage";
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

const NAV_ROUTES: RouteName[] = ["home", "inventory", "scan", "low-stock", "logs"];

type RouteHistoryEntry = {
  route: AppRoute;
  scrollY: number;
};

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

  const adminRoutes: RouteName[] = ["admin", "category-management", "unit-management", "supplier-management", "prep-items", "group-order-recipes", "settings", "staff-management"];
  if (adminRoutes.includes(routeName)) return role === "store_admin";

  return true;
}

function routeKey(route: AppRoute) {
  return JSON.stringify(route);
}

function updateBrowserPath(next: AppRoute) {
  if (next.name === "invite-accept" && next.inviteToken) {
    window.history.replaceState(null, "", `/invite/${encodeURIComponent(next.inviteToken)}`);
  } else {
    window.history.replaceState(null, "", "/");
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => initialRoute());
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(DARK_MODE_STORAGE_KEY) === "true");
  const [menuOpen, setMenuOpen] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const routeHistoryRef = useRef<RouteHistoryEntry[]>([]);
  const pendingScrollYRef = useRef<number | null>(null);

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
    let cancelled = false;

    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    const currentSession = session;

    async function loadProfile() {
      setProfileLoading(true);
      const existingProfile = await ensureCurrentProfile(currentSession);

      if (cancelled) return;

      if (existingProfile) {
        setProfile(existingProfile);
        setProfileLoading(false);
        return;
      }

      const inviteToken = route.inviteToken ?? route.authInviteToken;
      if (inviteToken) {
        const { data, error } = await supabase.rpc("accept_store_invite" as never, { invite_token: inviteToken } as never);
        if (!cancelled && !error && data) {
          const homeRoute: AppRoute = { name: "home" };
          setProfile(data as StaffProfile);
          pendingScrollYRef.current = 0;
          setRoute(homeRoute);
          updateBrowserPath(homeRoute);
          setProfileLoading(false);
          return;
        }
      }

      setProfile(null);
      setProfileLoading(false);
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [session, route.authInviteToken, route.inviteToken]);

  useEffect(() => {
    if (!session) return;
    if (route.name === "landing" || (route.name === "login" && !route.authInviteToken) || route.name === "signup-request") {
      const homeRoute: AppRoute = { name: "home" };
      pendingScrollYRef.current = 0;
      setRoute(homeRoute);
      updateBrowserPath(homeRoute);
    }
  }, [session, route.authInviteToken, route.name]);

  useEffect(() => {
    const pendingScrollY = pendingScrollYRef.current;
    if (pendingScrollY === null) return;

    pendingScrollYRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top: pendingScrollY, behavior: "auto" });
      window.setTimeout(() => window.scrollTo({ top: pendingScrollY, behavior: "auto" }), 150);
    });
  }, [route]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(darkMode));
  }, [darkMode]);

  const activeRoute = useMemo<RouteName>(() => {
    return NAV_ROUTES.includes(route.name) ? route.name : "home";
  }, [route.name]);

  function navigate(next: AppRoute, options: { replace?: boolean; resetHistory?: boolean; scrollY?: number } = {}) {
    setMenuOpen(false);
    if (options.resetHistory) {
      routeHistoryRef.current = [];
      setCanGoBack(false);
    } else if (!options.replace && routeKey(route) !== routeKey(next)) {
      routeHistoryRef.current.push({ route, scrollY: window.scrollY });
      setCanGoBack(true);
    }

    pendingScrollYRef.current = options.scrollY ?? 0;
    setRoute(next);
    updateBrowserPath(next);
  }

  function goBack() {
    const previous = routeHistoryRef.current.pop();
    if (!previous) return;

    setMenuOpen(false);
    setCanGoBack(routeHistoryRef.current.length > 0);
    pendingScrollYRef.current = previous.scrollY;
    setRoute(previous.route);
    updateBrowserPath(previous.route);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    routeHistoryRef.current = [];
    setCanGoBack(false);
    navigate({ name: "landing" }, { replace: true });
  }

  async function goToSignup(email = "", inviteToken = "") {
    if (session) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
    }
    routeHistoryRef.current = [];
    setCanGoBack(false);
    navigate({ name: "login", authMode: "signup", authEmail: email, authInviteToken: inviteToken }, { replace: true });
  }

  if (authLoading) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">로딩 중...</div>;
  }

    if (!session) {
    if (route.name === "login") {
      return (
        <LoginPage
          initialMode={route.authMode ?? "login"}
          initialEmail={route.authEmail ?? ""}
          inviteToken={route.authInviteToken}
          onInviteAccepted={(nextProfile) => {
            setProfile(nextProfile);
            navigate({ name: "home" }, { replace: true });
          }}
        />
      );
    }

    if (route.name === "signup-request") {
      return <SignupRequestPage onBack={() => navigate({ name: "landing" })} />;
    }

    if (route.name === "invite-accept" && route.inviteToken) {
      return (
        <InviteAcceptPage
          token={route.inviteToken}
          signedIn={false}
          onAccepted={(nextProfile) => {
            setProfile(nextProfile);
            navigate({ name: "home" }, { replace: true });
          }}
          onSignup={(email) => navigate({ name: "login", authMode: "signup", authEmail: email, authInviteToken: route.inviteToken })}
        />
      );
    }

    return <LandingPage onLogin={() => navigate({ name: "login" })} onSignupRequest={() => navigate({ name: "signup-request" })} />;
  }

  if (route.name === "invite-accept" && route.inviteToken) {
    return (
      <InviteAcceptPage
        token={route.inviteToken}
        signedIn={true}
        onSignup={(email) => void goToSignup(email, route.inviteToken)}
        onAccepted={(nextProfile) => {
          setProfile(nextProfile);
          navigate({ name: "home" }, { replace: true });
        }}
      />
    );
  }

  if (route.name === "login" && route.authInviteToken) {
    return (
      <LoginPage
        initialMode={route.authMode ?? "signup"}
        initialEmail={route.authEmail ?? ""}
        inviteToken={route.authInviteToken}
        onInviteAccepted={(nextProfile) => {
          setProfile(nextProfile);
          navigate({ name: "home" }, { replace: true });
        }}
      />
    );
  }

  if (profileLoading) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">매장 정보를 연결하는 중...</div>;
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
    <div className="min-h-dvh overflow-x-clip bg-slate-50 pb-24 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <OfflineBanner />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl min-w-0 items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <TopMenu open={menuOpen} role={profileRole} onOpenChange={setMenuOpen} onNavigate={(name) => navigate({ name }, { resetHistory: true })} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-700 dark:text-brand-100">통합 매장 재고관리 솔루션</p>
              <p className="max-w-[220px] truncate text-sm text-slate-500 dark:text-slate-400">{session.user.email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {profileRole !== "staff" ? (
              <button
                type="button"
                onClick={() => navigate({ name: profileRole === "master" ? "master-stores" : "staff-management" }, { resetHistory: true })}
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
        {canGoBack && permittedRoute.name !== "operation" ? (
          <button
            type="button"
            onClick={goBack}
            className="secondary-button mb-4 inline-flex items-center gap-2"
            aria-label="뒤로가기"
            title="뒤로가기"
          >
            <ArrowLeft size={18} />
            뒤로가기
          </button>
        ) : null}
        {permittedRoute.name === "home" && <HomePage navigate={navigate} currentStoreId={profile.store_id} />}
        {permittedRoute.name === "scan" && <ScanPage navigate={navigate} currentStoreId={profile.store_id} />}
        {permittedRoute.name === "register" && <ProductRegisterPage barcode={permittedRoute.barcode ?? ""} navigate={navigate} />}
        {permittedRoute.name === "product-edit" && (
          <ProductEditPage
            productId={permittedRoute.productId ?? ""}
            navigate={navigate}
            currentStoreId={profile.store_id}
            returnTo={permittedRoute.returnTo}
            prepDraft={permittedRoute.prepDraft}
            groupOrderDraft={permittedRoute.groupOrderDraft}
          />
        )}
        {permittedRoute.name === "operation" && (
          <InventoryOperationPage productId={permittedRoute.productId ?? ""} navigate={navigate} canGoBack={canGoBack} onBack={goBack} currentStoreId={profile.store_id} />
        )}
        {permittedRoute.name === "inventory" && <InventoryListPage navigate={navigate} currentStoreId={profile.store_id} />}
        {permittedRoute.name === "low-stock" && <LowStockPage navigate={navigate} currentStoreId={profile.store_id} />}
        {permittedRoute.name === "status-items" && <StatusItemsPage navigate={navigate} currentStoreId={profile.store_id} />}
        {permittedRoute.name === "logs" && <LogsPage navigate={navigate} currentStoreId={profile.store_id} />}
        {permittedRoute.name === "group-order" && (
          <GroupOrderCalculatorPage
            mode="calculator"
            navigate={navigate}
            currentStoreId={profile.store_id}
            currentRole={profileRole}
            restoreDraft={permittedRoute.groupOrderDraft}
          />
        )}
        {permittedRoute.name === "group-order-recipes" && (
          <GroupOrderCalculatorPage
            mode="recipes"
            navigate={navigate}
            currentStoreId={profile.store_id}
            currentRole={profileRole}
            restoreDraft={permittedRoute.groupOrderDraft}
          />
        )}
        {permittedRoute.name === "prep-items" && <PrepItemManagementPage navigate={navigate} restoreDraft={permittedRoute.prepDraft} />}
        {permittedRoute.name === "prep-mode" && <PrepModePage navigate={navigate} />}
        {permittedRoute.name === "category-management" && <CategoryManagementPage />}
        {permittedRoute.name === "unit-management" && <ProductUnitManagementPage />}
        {permittedRoute.name === "supplier-management" && <SupplierManagementPage />}
        {permittedRoute.name === "settings" && <SettingsPage />}
        {permittedRoute.name === "staff-management" && <StaffManagementPage />}
        {permittedRoute.name === "master-stores" && <MasterStoresPage />}
        {permittedRoute.name === "master-users" && <MasterUsersPage />}
        {permittedRoute.name === "admin" && <AdminPage />}
      </main>

      <BottomNav activeRoute={activeRoute} onNavigate={(name) => navigate({ name }, { resetHistory: true })} />
    </div>
  );
}
