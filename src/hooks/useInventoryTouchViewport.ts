import { useEffect, useState } from "react";

const INVENTORY_TOUCH_VIEWPORT_QUERY = "(max-width: 1024px)";

export function useInventoryTouchViewport(): boolean {
  const [isTouchViewport, setIsTouchViewport] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(INVENTORY_TOUCH_VIEWPORT_QUERY).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(INVENTORY_TOUCH_VIEWPORT_QUERY);
    const handleChange = () => setIsTouchViewport(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isTouchViewport;
}
