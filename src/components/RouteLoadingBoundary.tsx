import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";

const LOADING_MESSAGE_DELAY_MS = 120;

export function RouteLoadingFallback() {
  const [showMessage, setShowMessage] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowMessage(true), LOADING_MESSAGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="grid min-h-[40dvh] place-items-center" aria-live="polite" aria-busy="true">
      {showMessage ? <p className="text-sm font-semibold text-slate-500 dark:text-slate-400" role="status">화면을 여는 중...</p> : null}
    </div>
  );
}

type RouteErrorBoundaryProps = {
  children: ReactNode;
  onBack?: () => void;
};

type RouteErrorBoundaryState = {
  hasError: boolean;
};

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route rendering failed", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="grid min-h-[40dvh] place-items-center">
        <section className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100" role="alert">
          <p className="font-bold">화면을 불러오지 못했습니다.</p>
          <p className="mt-1 text-sm">연결 상태를 확인한 뒤 이전 화면으로 돌아가거나 앱을 새로고침해 주세요.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {this.props.onBack ? (
              <button type="button" className="secondary-button" onClick={this.props.onBack}>
                이전 화면
              </button>
            ) : null}
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              앱 새로고침
            </button>
          </div>
        </section>
      </div>
    );
  }
}
