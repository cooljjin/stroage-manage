import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950">
      오프라인 상태입니다. 조회된 화면은 볼 수 있지만 저장 작업은 연결 후 가능합니다.
    </div>
  );
}
