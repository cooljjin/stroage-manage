import { useEffect } from "react";
import { getIdlePreloadRoutes, preloadRoutePage } from "../routes/lazyPages";
import type { RouteName } from "../types/domain";

const FALLBACK_PRELOAD_DELAY_MS = 1000;

type IdleCallbackWindow = {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function useIdleRoutePreload(routeName: RouteName) {
  useEffect(() => {
    const queue = [...getIdlePreloadRoutes(routeName)];
    if (queue.length === 0) return;

    const idleWindow = window as unknown as IdleCallbackWindow;
    let cancelled = false;
    let idleCallbackId: number | null = null;
    let timeoutId: number | null = null;

    function cancelScheduledPreload() {
      if (idleCallbackId !== null) {
        idleWindow.cancelIdleCallback?.(idleCallbackId);
      }
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      idleCallbackId = null;
      timeoutId = null;
    }

    function preloadNext() {
      if (cancelled || document.visibilityState !== "visible") return;

      const nextRoute = queue.shift();
      if (!nextRoute) return;

      const preload = preloadRoutePage(nextRoute);
      if (!preload) {
        scheduleNext();
        return;
      }

      void preload.catch(() => undefined).finally(() => {
        if (!cancelled) scheduleNext();
      });
    }

    function scheduleNext() {
      if (cancelled || queue.length === 0 || document.visibilityState !== "visible") return;
      cancelScheduledPreload();

      if (idleWindow.requestIdleCallback) {
        idleCallbackId = idleWindow.requestIdleCallback(preloadNext, { timeout: 2000 });
        return;
      }

      timeoutId = window.setTimeout(preloadNext, FALLBACK_PRELOAD_DELAY_MS);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") return;
      cancelled = true;
      cancelScheduledPreload();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleNext();

    return () => {
      cancelled = true;
      cancelScheduledPreload();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [routeName]);
}
