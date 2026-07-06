type SkeletonBlockProps = {
  className?: string;
};

function SkeletonBlock({ className = "" }: SkeletonBlockProps) {
  return <span className={`skeleton-block block ${className}`} />;
}

export function InventoryTableSkeleton({ rows = 8, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <div className="panel overflow-hidden" aria-hidden="true">
      <div className={`grid border-b border-slate-100 bg-slate-100 px-3 py-3 dark:border-slate-900 dark:bg-slate-900 ${compact ? "grid-cols-[38%_13%_13%_36%]" : "grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem_7rem]"}`}>
        {Array.from({ length: compact ? 4 : 6 }, (_, index) => (
          <SkeletonBlock key={index} className="mx-1 h-3 rounded" />
        ))}
      </div>
      <div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={`grid items-center border-b border-slate-100 px-3 py-3 last:border-b-0 dark:border-slate-900 ${compact ? "grid-cols-[38%_13%_13%_36%]" : "grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem_7rem]"}`}>
            <div className="min-w-0 pr-3">
              <SkeletonBlock className="h-4 w-4/5 rounded" />
              <div className="mt-2 flex gap-1">
                <SkeletonBlock className="h-4 w-12 rounded" />
                <SkeletonBlock className="h-4 w-10 rounded" />
              </div>
            </div>
            <SkeletonBlock className="mx-1 h-4 rounded" />
            <SkeletonBlock className="mx-1 h-4 rounded" />
            {compact ? (
              <SkeletonBlock className="mx-auto h-10 w-20 rounded-md" />
            ) : (
              <>
                <SkeletonBlock className="mx-1 h-4 rounded" />
                <SkeletonBlock className="mx-1 h-4 rounded" />
                <SkeletonBlock className="mx-auto h-10 w-20 rounded-md" />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LowStockCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <SkeletonBlock className="h-5 w-2/3 rounded" />
          <div className="mt-4 grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
            <div>
              <SkeletonBlock className="h-3 w-10 rounded" />
              <SkeletonBlock className="mt-2 h-4 w-12 rounded" />
            </div>
            <div>
              <SkeletonBlock className="h-3 w-8 rounded" />
              <SkeletonBlock className="mt-2 h-4 w-10 rounded" />
            </div>
            <SkeletonBlock className="h-12 w-16 rounded-md" />
            <SkeletonBlock className="h-10 w-10 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
