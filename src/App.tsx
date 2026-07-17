import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp, type URLOpenListenerEvent } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";
import { BottomNav } from "./components/BottomNav";
import { OfflineBanner } from "./components/OfflineBanner";
import { TopMenu } from "./components/TopMenu";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupRequestPage } from "./pages/SignupRequestPage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
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
import { pageTransitionMotion, reducedPageTransitionMotion } from "./lib/animations";
import { ensureCurrentProfile } from "./lib/profiles";
import * as Services from "./services";
import { ACCOUNT_LINK_RETURN_STORAGE_KEY } from "./services";
import type { Session } from "./services";
import type { AppRoute, RouteName, StaffProfile } from "./types/domain";
import type { ProfileRole } from "./types/domain";

const NAV_ROUTES: RouteName[] = ["home", "inventory", "scan", "low-stock", "logs"];
const SCROLL_RESTORE_TIMEOUT_MS = 2500;
const SCROLL_RESTORE_TOLERANCE_PX = 2;
const POST_SCAN_ROUTE_STORAGE_KEY = "store-inventory-post-scan-route";
const POST_SCAN_ROUTE_TTL_MS = 5 * 60 * 1000;
const PENDING_SCAN_STORAGE_KEY = "store-inventory-pending-scan";
const PENDING_SCAN_TTL_MS = 5 * 60 * 1000;
const PENDING_INVITE_CODE_STORAGE_KEY = "store-inventory-pending-invite-code";

type RouteHistoryEntry = {
  route: AppRoute;
  scrollY: number;
};

type StoredRouteEntry = {
  route: AppRoute;
  savedAt: number;
};

type StoredPendingScanEntry = {
  savedAt: number;
};

function hasPendingScanBarcode() {
  const rawEntry = localStorage.getItem(PENDING_SCAN_STORAGE_KEY);
  if (!rawEntry) return false;

  try {
    const entry = JSON.parse(rawEntry) as StoredPendingScanEntry;
    if (Date.now() - entry.savedAt > PENDING_SCAN_TTL_MS) {
      localStorage.removeItem(PENDING_SCAN_STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    localStorage.removeItem(PENDING_SCAN_STORAGE_KEY);
    return false;
  }
}

function initialRoute(): AppRoute {
  return window.location.pathname === "/privacy" ? { name: "privacy" } : { name: "landing" };
}

function normalizeInviteCode(value: string | null) {
  return value?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
}

function readInviteCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeInviteCode(params.get("inviteCode") ?? params.get("invite_code") ?? params.get("code"));
}

function readPendingInviteCode() {
  return normalizeInviteCode(localStorage.getItem(PENDING_INVITE_CODE_STORAGE_KEY));
}

function savePendingInviteCode(code: string) {
  const normalized = normalizeInviteCode(code);
  if (normalized) {
    localStorage.setItem(PENDING_INVITE_CODE_STORAGE_KEY, normalized);
  }
  return normalized;
}

function clearPendingInviteCode() {
  localStorage.removeItem(PENDING_INVITE_CODE_STORAGE_KEY);
}

function defaultSignedInRoute(): AppRoute {
  return hasPendingScanBarcode() ? { name: "scan", scanLaunchId: Date.now() } : { name: "home" };
}

function consumeAccountLinkReturnRoute(): AppRoute | null {
  const linkingProvider = localStorage.getItem(ACCOUNT_LINK_RETURN_STORAGE_KEY);
  if (!linkingProvider) return null;
  localStorage.removeItem(ACCOUNT_LINK_RETURN_STORAGE_KEY);
  return { name: "settings" };
}

function isPostScanRoute(route: AppRoute) {
  return route.name === "operation" || route.name === "register";
}

function savePostScanRoute(route: AppRoute) {
  if (!isPostScanRoute(route)) return;
  const entry: StoredRouteEntry = { route, savedAt: Date.now() };
  localStorage.setItem(POST_SCAN_ROUTE_STORAGE_KEY, JSON.stringify(entry));
}

function consumePostScanRoute(): AppRoute | null {
  const rawEntry = localStorage.getItem(POST_SCAN_ROUTE_STORAGE_KEY);
  if (!rawEntry) return null;

  try {
    const entry = JSON.parse(rawEntry) as StoredRouteEntry;
    if (!isPostScanRoute(entry.route) || Date.now() - entry.savedAt > POST_SCAN_ROUTE_TTL_MS) {
      localStorage.removeItem(POST_SCAN_ROUTE_STORAGE_KEY);
      return null;
    }
    localStorage.removeItem(POST_SCAN_ROUTE_STORAGE_KEY);
    return entry.route;
  } catch {
    localStorage.removeItem(POST_SCAN_ROUTE_STORAGE_KEY);
    return null;
  }
}

function getProfileRole(profile: StaffProfile): ProfileRole {
  return profile.role ?? (profile.is_admin ? "store_admin" : "staff");
}

function canAccess(routeName: RouteName, profile: StaffProfile) {
  const role = getProfileRole(profile);
  if (role === "master") return true;

  const masterRoutes: RouteName[] = ["master-stores", "master-store-detail", "master-users"];
  if (masterRoutes.includes(routeName)) return false;

  const adminRoutes: RouteName[] = ["admin", "category-management", "unit-management", "supplier-management", "prep-items", "group-order-recipes", "staff-management"];
  if (adminRoutes.includes(routeName)) return role === "store_admin";

  return true;
}

function routeKey(route: AppRoute) {
  return JSON.stringify(route);
}

function updateBrowserPath(nextRoute?: AppRoute) {
  window.history.replaceState(null, "", nextRoute?.name === "privacy" ? "/privacy" : "/");
}

function maxWindowScrollY() {
  const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  return Math.max(0, scrollHeight - window.innerHeight);
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
  const [storeName, setStoreName] = useState("");
  const [inviteCode, setInviteCode] = useState(() => savePendingInviteCode(readInviteCodeFromUrl()) || readPendingInviteCode());
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const routeHistoryRef = useRef<RouteHistoryEntry[]>([]);
  const pendingScrollYRef = useRef<number | null>(null);
  const profileRef = useRef<StaffProfile | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    const codeFromUrl = readInviteCodeFromUrl();
    if (codeFromUrl) {
      setInviteCode(savePendingInviteCode(codeFromUrl));
      updateBrowserPath(window.location.pathname === "/privacy" ? { name: "privacy" } : { name: "landing" });
    }

    Services.AuthService.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = Services.AuthService.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listenerHandle: PluginListenerHandle | null = null;
    let cancelled = false;

    CapacitorApp
      .addListener("appUrlOpen", (event) => {
        const urlOpenEvent = event as URLOpenListenerEvent;
        const url = urlOpenEvent.url;
        if (!url.startsWith("com.jinkim.storeinventory.poc://auth/callback")) return;
        void Services.AuthService.handleOAuthCallbackUrl(url).then(({ data, error }) => {
          if (cancelled) return;
          if (!error) {
            setSession(data.session);
          }
        });
      })
      .then((handle) => {
        if (cancelled) {
          void handle.remove();
        } else {
          listenerHandle = handle;
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
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
      setProfileLoading(profileRef.current === null);
      const existingProfile = await ensureCurrentProfile(currentSession);

      if (cancelled) return;

      if (existingProfile) {
        setProfile(existingProfile);
        clearPendingInviteCode();
        setProfileLoading(false);
        return;
      }

      setProfile(null);
      setProfileLoading(false);
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (route.name === "landing" || route.name === "login" || route.name === "signup-request") {
      const homeRoute = consumeAccountLinkReturnRoute() ?? consumePostScanRoute() ?? defaultSignedInRoute();
      pendingScrollYRef.current = 0;
      setRoute(homeRoute);
      updateBrowserPath(homeRoute);
    }
  }, [session, route.name]);

  useEffect(() => {
    const pendingScrollY = pendingScrollYRef.current;
    if (pendingScrollY === null) return;

    const scrollY = pendingScrollY;
    pendingScrollYRef.current = null;
    let frameId = 0;
    let timeoutId = 0;
    let cancelled = false;
    const startedAt = performance.now();

    function restoreScroll() {
      if (cancelled) return;

      window.scrollTo({ top: scrollY, behavior: "auto" });

      const reachedTarget = Math.abs(window.scrollY - scrollY) <= SCROLL_RESTORE_TOLERANCE_PX;
      const canReachTarget = maxWindowScrollY() >= scrollY;
      const timedOut = performance.now() - startedAt >= SCROLL_RESTORE_TIMEOUT_MS;
      if ((reachedTarget && canReachTarget) || timedOut) return;

      frameId = requestAnimationFrame(restoreScroll);
    }

    frameId = requestAnimationFrame(restoreScroll);
    timeoutId = window.setTimeout(restoreScroll, 150);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [route]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(darkMode));
  }, [darkMode]);

  const activeRoute = useMemo<RouteName>(() => {
    return NAV_ROUTES.includes(route.name) ? route.name : "home";
  }, [route.name]);

  function navigateFromBottomNav(name: RouteName) {
    navigate(name === "scan" ? { name, scanLaunchId: Date.now() } : { name }, { resetHistory: true });
  }

  function navigate(next: AppRoute, options: { replace?: boolean; resetHistory?: boolean; scrollY?: number } = {}) {
    setMenuOpen(false);
    if (route.name === "scan") {
      savePostScanRoute(next);
    }
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
    await Services.AuthService.signOut();
    routeHistoryRef.current = [];
    setCanGoBack(false);
    setProfile(null);
    setConnectionError("");
    setConnectionMessage("");
    navigate({ name: "landing" }, { replace: true });
  }

  async function createPersonalStore(event: FormEvent) {
    event.preventDefault();
    const name = storeName.trim();
    if (!name) {
      setConnectionError("매장 이름을 입력해 주세요.");
      return;
    }

    setConnectionLoading(true);
    setConnectionError("");
    setConnectionMessage("");

    const { data, error } = await Services.DatabaseService.rpc("create_personal_store", { store_name: name });
    if (error) {
      setConnectionError(error.message);
    } else if (data) {
      const nextProfile = data as StaffProfile;
      setProfile(nextProfile);
      setStoreName("");
      clearPendingInviteCode();
      setConnectionMessage("");
      navigate(defaultSignedInRoute(), { replace: true });
    }

    setConnectionLoading(false);
  }

  async function acceptInviteCode(event: FormEvent) {
    event.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setConnectionError("초대코드를 입력해 주세요.");
      return;
    }

    setConnectionLoading(true);
    setConnectionError("");
    setConnectionMessage("");

    const { data, error } = await Services.DatabaseService.rpc("accept_store_invite_code", { invite_code: code });
    if (error) {
      setConnectionError(error.message);
    } else if (data) {
      const nextProfile = data as StaffProfile;
      setProfile(nextProfile);
      setInviteCode("");
      clearPendingInviteCode();
      setConnectionMessage("");
      navigate(defaultSignedInRoute(), { replace: true });
    }

    setConnectionLoading(false);
  }

  if (route.name === "privacy") {
    return <PrivacyPolicyPage />;
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
        />
      );
    }

    if (route.name === "signup-request") {
      return <SignupRequestPage onBack={() => navigate({ name: "landing" })} />;
    }

    return <LandingPage onLogin={() => navigate({ name: "login" })} />;
  }

  if (profileLoading && !profile) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">매장 정보를 연결하는 중...</div>;
  }

  if (!profile) {
    return (
      <div className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4">
            <p className="text-2xl font-bold">매장 연결</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">새 매장을 만들거나 관리자에게 받은 초대코드를 입력해 주세요.</p>
          </div>

          {connectionError ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-100">{connectionError}</div> : null}
          {connectionMessage ? <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{connectionMessage}</div> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <form onSubmit={createPersonalStore} className="panel p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-brand-600 text-white">
                  <Plus size={20} />
                </div>
                <div>
                  <p className="font-bold">새 매장 만들기</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">관리자 권한으로 시작합니다.</p>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">매장 이름</span>
                <input className="field" value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="예: 강남점" disabled={connectionLoading} />
              </label>
              <button type="submit" className="primary-button mt-3 w-full" disabled={connectionLoading}>
                {connectionLoading ? "처리 중..." : "새 매장 만들기"}
              </button>
            </form>

            <form onSubmit={acceptInviteCode} className="panel p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
                  <KeyRound size={20} />
                </div>
                <div>
                  <p className="font-bold">초대코드로 참여</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">초대한 매장으로 계정을 연결합니다.</p>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">초대코드</span>
                <input className="field uppercase tracking-widest" value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="ABCD2345" disabled={connectionLoading} />
              </label>
              <button type="submit" className="secondary-button mt-3 w-full" disabled={connectionLoading}>
                {connectionLoading ? "처리 중..." : "초대코드로 참여"}
              </button>
            </form>
          </div>

          <button type="button" onClick={handleLogout} className="secondary-button mt-4 w-full">
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  const permittedRoute = canAccess(route.name, profile) ? route : { name: "home" as const };
  const profileRole = getProfileRole(profile);
  const routeMotionProps = shouldReduceMotion ? reducedPageTransitionMotion : pageTransitionMotion;

  return (
    <div className="min-h-dvh overflow-x-clip bg-slate-50 pb-24 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <OfflineBanner />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl min-w-0 items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-0">
            <TopMenu open={menuOpen} role={profileRole} onOpenChange={setMenuOpen} onNavigate={(name) => navigate({ name }, { resetHistory: true })} />
            <img src="/stockly-logo.png" alt="Stockly" className="-ml-1 h-12 w-auto min-w-0 object-contain sm:h-14" />
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
        <LazyMotion features={domAnimation}>
          <m.div key={routeKey(permittedRoute)} initial={routeMotionProps.initial} animate={routeMotionProps.animate} transition={routeMotionProps.transition}>
            {permittedRoute.name === "home" && <HomePage navigate={navigate} currentStoreId={profile.store_id} />}
            {permittedRoute.name === "scan" && <ScanPage navigate={navigate} currentStoreId={profile.store_id} scanLaunchId={permittedRoute.scanLaunchId} />}
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
            {permittedRoute.name === "low-stock" && <LowStockPage navigate={navigate} currentStoreId={profile.store_id} currentRole={profileRole} />}
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
            {permittedRoute.name === "category-management" && <CategoryManagementPage currentStoreId={profile.store_id} />}
            {permittedRoute.name === "unit-management" && <ProductUnitManagementPage />}
            {permittedRoute.name === "supplier-management" && <SupplierManagementPage />}
            {permittedRoute.name === "settings" && <SettingsPage currentRole={profileRole} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((value) => !value)} onLogout={handleLogout} />}
            {permittedRoute.name === "staff-management" && <StaffManagementPage />}
            {permittedRoute.name === "master-stores" && <MasterStoresPage />}
            {permittedRoute.name === "master-users" && <MasterUsersPage />}
            {permittedRoute.name === "admin" && <AdminPage />}
          </m.div>
        </LazyMotion>
      </main>

      <BottomNav activeRoute={activeRoute} onNavigate={navigateFromBottomNav} />
    </div>
  );
}
