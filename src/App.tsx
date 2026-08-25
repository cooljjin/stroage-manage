import { FormEvent, useEffect, useRef, useState } from "react";
import { App as CapacitorApp, type URLOpenListenerEvent } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";
import { BottomNav } from "./components/BottomNav";
import { OfflineBanner } from "./components/OfflineBanner";
import { RoleBadge, TopMenu } from "./components/TopMenu";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { PasswordResetPage } from "./pages/PasswordResetPage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { SupportPage } from "./pages/SupportPage";
import { AccountDeletionRecoveryPage } from "./pages/AccountDeletionRecoveryPage";
import { MasterAccountBlockedPage } from "./pages/MasterAccountBlockedPage";
import { HomePage } from "./pages/HomePage";
import { TimelineCalendarPage } from "./pages/TimelineCalendarPage";
import { recoverMobileInventorySessions } from "./lib/mobileInventorySession";
import { ScanPage } from "./pages/ScanPage";
import { ProductEditPage } from "./pages/ProductEditPage";
import { InventoryOperationPage } from "./pages/InventoryOperationPage";
import { InventoryListPage, type InventoryListPageState } from "./pages/InventoryListPage";
import { LowStockPage } from "./pages/LowStockPage";
import { StatusItemsPage } from "./pages/StatusItemsPage";
import { LogsPage } from "./pages/LogsPage";
import { TodoRoutinesPage } from "./pages/TodoRoutinesPage";
import { GroupOrderCalculatorPage } from "./pages/GroupOrderCalculatorPage";
import { RecipeImportPage } from "./pages/RecipeImportPage";
import { PrepItemManagementPage } from "./pages/PrepItemManagementPage";
import { PrepModePage } from "./pages/PrepModePage";
import { CategoryManagementPage } from "./pages/CategoryManagementPage";
import { ProductUnitManagementPage } from "./pages/ProductUnitManagementPage";
import { SupplierManagementPage } from "./pages/SupplierManagementPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StaffManagementPage } from "./pages/StaffManagementPage";
import { StaffPermissionsPage } from "./pages/StaffPermissionsPage";
import { DARK_MODE_STORAGE_KEY } from "./lib/constants";
import { hasStaffPermission, permissionForRoute } from "./lib/staffPermissions";
import { pageTransitionMotion, reducedPageTransitionMotion } from "./lib/animations";
import { ensureCurrentProfile } from "./lib/profiles";
import * as Services from "./services";
import { ACCOUNT_LINK_RETURN_STORAGE_KEY } from "./services";
import type { Session } from "./services";
import type { AppRoute, RouteName, StaffPermission, StaffPermissionKey, StaffProfile } from "./types/domain";
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

type NavigationTab = (typeof NAV_ROUTES)[number];

type NavigationStacks = Partial<Record<NavigationTab, RouteHistoryEntry[]>>;

type BrowserNavigationState = {
  stocklyNavigation: true;
  activeTab: NavigationTab;
  stacks: NavigationStacks;
};

type NavigationOptions = {
  replace?: boolean;
  resetHistory?: boolean;
  resetToRoot?: boolean;
  restore?: boolean;
  scrollY?: number;
};

type RouteLeaveHandler = () => Promise<void>;

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
  if (window.location.pathname === "/privacy") return { name: "privacy" };
  if (window.location.pathname === "/support") return { name: "support" };
  if (window.location.pathname === "/password-reset") return { name: "password-reset" };
  return { name: "landing" };
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

function canAccess(routeName: RouteName, profile: StaffProfile, staffPermissions: readonly StaffPermissionKey[]) {
  const role = getProfileRole(profile);

  const permission = permissionForRoute(routeName);
  if (permission) return role === "store_admin" || hasStaffPermission(staffPermissions, permission);

  const adminRoutes: RouteName[] = ["prep-items", "staff-management", "staff-permissions"];
  if (adminRoutes.includes(routeName)) return role === "store_admin";

  return true;
}

function routeKey(route: AppRoute) {
  return JSON.stringify(route);
}

function browserPathForRoute(nextRoute?: AppRoute) {
  if (nextRoute?.name === "privacy") return "/privacy";
  if (nextRoute?.name === "support") return "/support";
  if (nextRoute?.name === "password-reset") return "/password-reset";
  return "/";
}

function isBrowserNavigationState(value: unknown): value is BrowserNavigationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BrowserNavigationState>;
  return state.stocklyNavigation === true && NAV_ROUTES.includes(state.activeTab as NavigationTab) && Boolean(state.stacks);
}

function createNavigationStacks(route: AppRoute): NavigationStacks {
  return {
    home: [{ route, scrollY: 0 }]
  };
}

function maxWindowScrollY() {
  const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  return Math.max(0, scrollHeight - window.innerHeight);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [staffPermissions, setStaffPermissions] = useState<StaffPermissionKey[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => initialRoute());
  const [activeTab, setActiveTab] = useState<NavigationTab>("home");
  const [inventoryListState, setInventoryListState] = useState<InventoryListPageState>();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(DARK_MODE_STORAGE_KEY) === "true");
  const [menuOpen, setMenuOpen] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [inviteCode, setInviteCode] = useState(() => savePendingInviteCode(readInviteCodeFromUrl()) || readPendingInviteCode());
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const navigationStacksRef = useRef<NavigationStacks>(createNavigationStacks(initialRoute()));
  const activeTabRef = useRef<NavigationTab>("home");
  const pendingScrollYRef = useRef<number | null>(null);
  const profileRef = useRef<StaffProfile | null>(null);
  const routeRef = useRef(route);
  const navigateRef = useRef<(next: AppRoute, options?: NavigationOptions) => void>(() => undefined);
  const goBackRef = useRef<() => boolean>(() => false);
  const routeLeaveHandlerRef = useRef<RouteLeaveHandler | null>(null);
  const routeLeaveInFlightRef = useRef<Promise<void> | null>(null);
  const shouldReduceMotion = useReducedMotion();

  routeRef.current = route;

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const codeFromUrl = readInviteCodeFromUrl();
    if (codeFromUrl) {
      setInviteCode(savePendingInviteCode(codeFromUrl));
      window.history.replaceState(window.history.state, "", browserPathForRoute(window.location.pathname === "/privacy" ? { name: "privacy" } : { name: "landing" }));
    }

    Services.AuthService.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = Services.AuthService.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (event === "PASSWORD_RECOVERY") {
        navigateRef.current({ name: "password-reset" }, { resetHistory: true });
      }
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
        if (!Services.AuthService.isNativeAuthCallbackUrl(url)) return;
        void Services.AuthService.handleOAuthCallbackUrl(url).then(({ data, error }) => {
          if (cancelled) return;
          if (!error) {
            setSession(data.session);
            if (Services.AuthService.isPasswordRecoveryUrl(url)) {
              navigateRef.current({ name: "password-reset" }, { resetHistory: true });
            }
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
      setStaffPermissions([]);
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
        if (import.meta.env.VITE_MOBILE_INVENTORY_TOUCH_ENABLED !== "false") {
          void recoverMobileInventorySessions();
        }
        const { data: permissions } = await Services.DatabaseService.select("staff_permissions", "permission_key")
          .eq("store_id", existingProfile.store_id)
          .eq("user_id", existingProfile.id);
        if (!cancelled) {
          setStaffPermissions(((permissions ?? []) as Pick<StaffPermission, "permission_key">[]).map((permission) => permission.permission_key));
        }
        clearPendingInviteCode();
        setProfileLoading(false);
        return;
      }

      setProfile(null);
      setStaffPermissions([]);
      setProfileLoading(false);
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (route.name === "landing" || route.name === "login") {
      const homeRoute = consumeAccountLinkReturnRoute() ?? consumePostScanRoute() ?? defaultSignedInRoute();
      navigateRef.current(homeRoute, { resetHistory: true, replace: true });
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

    function stopRestoring() {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("wheel", stopRestoring);
      window.removeEventListener("touchmove", stopRestoring);
      window.removeEventListener("keydown", handleKeyDown);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
        stopRestoring();
      }
    }

    function restoreScroll() {
      if (cancelled) return;

      window.scrollTo({ top: scrollY, behavior: "auto" });

      const reachedTarget = Math.abs(window.scrollY - scrollY) <= SCROLL_RESTORE_TOLERANCE_PX;
      const canReachTarget = maxWindowScrollY() >= scrollY;
      const timedOut = performance.now() - startedAt >= SCROLL_RESTORE_TIMEOUT_MS;
      if ((reachedTarget && canReachTarget) || timedOut) {
        stopRestoring();
        return;
      }

      frameId = requestAnimationFrame(restoreScroll);
    }

    window.addEventListener("wheel", stopRestoring, { passive: true });
    window.addEventListener("touchmove", stopRestoring, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    frameId = requestAnimationFrame(restoreScroll);
    timeoutId = window.setTimeout(restoreScroll, 150);

    return stopRestoring;
  }, [route]);

  useEffect(() => {
    const browserState: BrowserNavigationState = {
      stocklyNavigation: true,
      activeTab: activeTabRef.current,
      stacks: navigationStacksRef.current
    };
    window.history.replaceState(browserState, "", browserPathForRoute(routeRef.current));

    async function handlePopState(event: PopStateEvent) {
      if (!isBrowserNavigationState(event.state)) return;

      const restoredEntries = event.state.stacks[event.state.activeTab];
      const restoredEntry = restoredEntries?.[restoredEntries.length - 1];
      if (!restoredEntry) return;

      await runRouteLeaveHandler();
      navigationStacksRef.current = event.state.stacks;
      activeTabRef.current = event.state.activeTab;
      pendingScrollYRef.current = restoredEntry.scrollY;
      setMenuOpen(false);
      setActiveTab(event.state.activeTab);
      setRoute(restoredEntry.route);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listenerHandle: PluginListenerHandle | null = null;
    let cancelled = false;
    CapacitorApp.addListener("backButton", () => {
      goBackRef.current();
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
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(darkMode));
  }, [darkMode]);

  const canGoBack = (navigationStacksRef.current[activeTab]?.length ?? 0) > 1;

  function registerBeforeLeave(handler: RouteLeaveHandler) {
    routeLeaveHandlerRef.current = handler;
    return () => {
      if (routeLeaveHandlerRef.current === handler) routeLeaveHandlerRef.current = null;
    };
  }

  async function runRouteLeaveHandler() {
    if (!routeLeaveHandlerRef.current) return;
    if (routeLeaveInFlightRef.current) {
      await routeLeaveInFlightRef.current;
      return;
    }

    const pendingLeave = routeLeaveHandlerRef.current();
    routeLeaveInFlightRef.current = pendingLeave;
    try {
      await pendingLeave;
    } finally {
      routeLeaveInFlightRef.current = null;
    }
  }

  function writeBrowserNavigationState(nextRoute: AppRoute, browserState: BrowserNavigationState, replace = false) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method](browserState, "", browserPathForRoute(nextRoute));
  }

  function commitNavigation(nextRoute: AppRoute, nextActiveTab: NavigationTab, nextStacks: NavigationStacks, scrollY: number, replaceBrowserState = false) {
    const browserState: BrowserNavigationState = {
      stocklyNavigation: true,
      activeTab: nextActiveTab,
      stacks: nextStacks
    };

    navigationStacksRef.current = nextStacks;
    activeTabRef.current = nextActiveTab;
    pendingScrollYRef.current = scrollY;
    setActiveTab(nextActiveTab);
    setRoute(nextRoute);
    writeBrowserNavigationState(nextRoute, browserState, replaceBrowserState);
  }

  function saveCurrentScroll(stacks: NavigationStacks, tab: NavigationTab) {
    const entries = stacks[tab];
    if (!entries?.length) return;
    entries[entries.length - 1] = { ...entries[entries.length - 1], scrollY: window.scrollY };
  }

  function navigateFromBottomNav(name: RouteName) {
    const nextRoute = name === "scan" ? { name, scanLaunchId: Date.now() } : { name };
    const isActiveTab = activeTabRef.current === name;
    navigate(nextRoute, isActiveTab ? { resetHistory: true } : { restore: true });
  }

  function commitRequestedNavigation(next: AppRoute, options: NavigationOptions = {}) {
    setMenuOpen(false);
    if (route.name === "scan") {
      savePostScanRoute(next);
    }

    const currentTab = activeTabRef.current;
    const targetTab = NAV_ROUTES.includes(next.name) && (options.restore || options.resetHistory || options.resetToRoot)
      ? next.name as NavigationTab
      : currentTab;
    const nextStacks: NavigationStacks = Object.fromEntries(
      Object.entries(navigationStacksRef.current).map(([tab, entries]) => [tab, entries ? [...entries] : entries])
    ) as NavigationStacks;

    saveCurrentScroll(nextStacks, currentTab);

    if (options.resetHistory) {
      nextStacks[targetTab] = [{ route: next, scrollY: options.scrollY ?? 0 }];
      commitNavigation(next, targetTab, nextStacks, options.scrollY ?? 0, options.replace ?? false);
      return;
    }

    if (options.resetToRoot) {
      const rootEntry = nextStacks[targetTab]?.[0];
      nextStacks[targetTab] = [{ route: next, scrollY: options.scrollY ?? rootEntry?.scrollY ?? 0 }];
      commitNavigation(next, targetTab, nextStacks, options.scrollY ?? rootEntry?.scrollY ?? 0, options.replace ?? false);
      return;
    }

    if (options.restore) {
      const targetEntries = nextStacks[targetTab];
      const restoredEntry = targetEntries?.[targetEntries.length - 1];
      const restoredRoute = restoredEntry?.route ?? next;
      if (!restoredEntry) {
        nextStacks[targetTab] = [{ route: next, scrollY: options.scrollY ?? 0 }];
      }
      commitNavigation(restoredRoute, targetTab, nextStacks, options.scrollY ?? restoredEntry?.scrollY ?? 0);
      return;
    }

    const entries = nextStacks[targetTab] ?? [];
    if (options.replace) {
      if (entries.length) {
        entries[entries.length - 1] = { route: next, scrollY: options.scrollY ?? 0 };
      } else {
        entries.push({ route: next, scrollY: options.scrollY ?? 0 });
      }
    } else if (routeKey(route) !== routeKey(next)) {
      entries.push({ route: next, scrollY: options.scrollY ?? 0 });
    }
    nextStacks[targetTab] = entries;
    commitNavigation(next, targetTab, nextStacks, options.scrollY ?? 0, options.replace ?? false);
  }

  function navigate(next: AppRoute, options: NavigationOptions = {}) {
    if (routeRef.current.name === "operation" && routeKey(routeRef.current) !== routeKey(next)) {
      void runRouteLeaveHandler().then(() => commitRequestedNavigation(next, options));
      return;
    }
    commitRequestedNavigation(next, options);
  }

  function resetNavigation(next: AppRoute) {
    const nextTab = NAV_ROUTES.includes(next.name) ? next.name as NavigationTab : "home";
    commitNavigation(next, nextTab, { [nextTab]: [{ route: next, scrollY: 0 }] }, 0, true);
  }

  function commitGoBack() {
    const currentTab = activeTabRef.current;
    const currentEntries = navigationStacksRef.current[currentTab];
    if (!currentEntries || currentEntries.length <= 1) return false;

    const nextStacks: NavigationStacks = {
      ...navigationStacksRef.current,
      [currentTab]: currentEntries.slice(0, -1)
    };
    const previousEntries = nextStacks[currentTab];
    const previous = previousEntries?.[previousEntries.length - 1];
    if (!previous) return false;

    setMenuOpen(false);
    commitNavigation(previous.route, currentTab, nextStacks, previous.scrollY);
    return true;
  }

  function goBack() {
    if (routeRef.current.name === "operation") {
      void runRouteLeaveHandler().then(() => {
        commitGoBack();
      });
      return true;
    }
    return commitGoBack();
  }

  navigateRef.current = navigate;
  goBackRef.current = goBack;

  async function handleLogout() {
    await runRouteLeaveHandler();
    await Services.AuthService.signOut();
    setProfile(null);
    setStaffPermissions([]);
    setConnectionError("");
    setConnectionMessage("");
    resetNavigation({ name: "landing" });
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
      resetNavigation(defaultSignedInRoute());
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
      resetNavigation(defaultSignedInRoute());
    }

    setConnectionLoading(false);
  }

  if (route.name === "privacy") {
    return <PrivacyPolicyPage />;
  }

  if (route.name === "support") {
    return <SupportPage />;
  }

  if (authLoading) {
    return <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">로딩 중...</div>;
  }

  if (route.name === "password-reset") {
    return <PasswordResetPage onCompleted={() => void handleLogout()} />;
  }

  if (!session) {
    if (route.name === "login") {
      return (
        <LoginPage
          initialMode={route.authMode ?? "login"}
          initialEmail={route.authEmail ?? ""}
          onOpenPrivacy={() => navigate({ name: "privacy" })}
          onOpenSupport={() => navigate({ name: "support" })}
        />
      );
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

  if (profile.deletion_requested_at) {
    return <AccountDeletionRecoveryPage onRecovered={(nextProfile) => setProfile(nextProfile)} />;
  }

  if (getProfileRole(profile) === "master") {
    return <MasterAccountBlockedPage onLogout={() => void handleLogout()} onOpenSupport={() => navigate({ name: "support" }, { resetHistory: true })} />;
  }

  const hasRouteAccess = canAccess(route.name, profile, staffPermissions);
  const permittedRoute = hasRouteAccess ? route : { name: "home" as const };
  const profileRole = getProfileRole(profile);
  const routeMotionProps = shouldReduceMotion ? reducedPageTransitionMotion : pageTransitionMotion;

  return (
    <div className="min-h-dvh overflow-x-clip bg-slate-50 pb-24 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <OfflineBanner />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl min-w-0 items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-0">
            <TopMenu open={menuOpen} role={profileRole} staffPermissions={staffPermissions} onOpenChange={setMenuOpen} onNavigate={(name) => navigate({ name }, { resetHistory: true })} />
            <img src="/stockly-logo.png" alt="Stockly" className="ml-2 h-10 w-auto min-w-0 shrink-0 object-contain sm:h-12" />
            <RoleBadge role={profileRole} />
          </div>
        </div>
      </header>

      <main className={`mx-auto min-w-0 max-w-6xl px-4 py-4 ${permittedRoute.name === "operation" ? "inventory-operation-main" : ""}`}>
        {!hasRouteAccess ? (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100" role="status">
            현재 계정 권한으로 사용할 수 없는 메뉴입니다. 매장 관리자에게 필요한 권한을 요청해 주세요.
          </div>
        ) : null}
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
            {permittedRoute.name === "timeline-calendar" && <TimelineCalendarPage currentStoreId={profile.store_id} />}
            {permittedRoute.name === "scan" && <ScanPage navigate={navigate} currentStoreId={profile.store_id} scanLaunchId={permittedRoute.scanLaunchId} />}
            {permittedRoute.name === "register" && (
              <ProductEditPage
                barcode={permittedRoute.barcode ?? ""}
                navigate={navigate}
                currentStoreId={profile.store_id}
              />
            )}
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
              <InventoryOperationPage
                productId={permittedRoute.productId ?? ""}
                navigate={navigate}
                canGoBack={canGoBack}
                onBack={goBack}
                currentStoreId={profile.store_id}
                initialInventoryMode={permittedRoute.initialInventoryMode}
                registerBeforeLeave={registerBeforeLeave}
              />
            )}
            {permittedRoute.name === "inventory" && (
              <InventoryListPage
                navigate={navigate}
                currentStoreId={profile.store_id}
                canManageImportantItems={profileRole !== "staff"}
                initialState={inventoryListState}
                onStateChange={setInventoryListState}
              />
            )}
            {permittedRoute.name === "low-stock" && (
              <LowStockPage
                navigate={navigate}
                currentStoreId={profile.store_id}
                canConfirmOrderItems={profileRole !== "staff" || hasStaffPermission(staffPermissions, "order_confirmation")}
                canAddUnconfirmedOrderItems={profileRole !== "staff"}
              />
            )}
            {permittedRoute.name === "status-items" && <StatusItemsPage navigate={navigate} currentStoreId={profile.store_id} />}
            {permittedRoute.name === "logs" && <LogsPage navigate={navigate} currentStoreId={profile.store_id} />}
            {permittedRoute.name === "todo-routines" && <TodoRoutinesPage currentStoreId={profile.store_id} />}
            {permittedRoute.name === "group-order" && (
              <GroupOrderCalculatorPage
                mode="calculator"
                navigate={navigate}
                currentStoreId={profile.store_id}
                canManageRecipes={profileRole !== "staff" || hasStaffPermission(staffPermissions, "group_order_recipe_management")}
                restoreDraft={permittedRoute.groupOrderDraft}
              />
            )}
            {permittedRoute.name === "group-order-recipes" && (
              <GroupOrderCalculatorPage
                mode="recipes"
                navigate={navigate}
                currentStoreId={profile.store_id}
                canManageRecipes={profileRole !== "staff" || hasStaffPermission(staffPermissions, "group_order_recipe_management")}
                restoreDraft={permittedRoute.groupOrderDraft}
              />
            )}
            {permittedRoute.name === "group-order-recipe-import" && (
              <RecipeImportPage
                navigate={navigate}
                currentStoreId={profile.store_id}
                canManageRecipes={profileRole !== "staff" || hasStaffPermission(staffPermissions, "group_order_recipe_management")}
                jobId={permittedRoute.recipeImportJobId}
              />
            )}
            {permittedRoute.name === "prep-items" && <PrepItemManagementPage navigate={navigate} restoreDraft={permittedRoute.prepDraft} />}
            {permittedRoute.name === "prep-mode" && <PrepModePage navigate={navigate} />}
            {permittedRoute.name === "category-management" && <CategoryManagementPage currentStoreId={profile.store_id} />}
            {permittedRoute.name === "unit-management" && <ProductUnitManagementPage currentStoreId={profile.store_id} />}
            {permittedRoute.name === "supplier-management" && <SupplierManagementPage />}
            {permittedRoute.name === "settings" && <SettingsPage currentRole={profileRole} currentStoreId={profile.store_id} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((value) => !value)} onLogout={handleLogout} />}
            {permittedRoute.name === "staff-management" && <StaffManagementPage />}
            {permittedRoute.name === "staff-permissions" && <StaffPermissionsPage currentStoreId={profile.store_id} />}
          </m.div>
        </LazyMotion>
      </main>

      <BottomNav activeRoute={activeTab} onNavigate={navigateFromBottomNav} />
    </div>
  );
}
