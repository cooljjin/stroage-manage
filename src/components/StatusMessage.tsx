type Props = {
  type?: "error" | "info" | "success";
  children: React.ReactNode;
};

export function StatusMessage({ type = "info", children }: Props) {
  const classes = {
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
    info: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
  };

  return <div className={`whitespace-pre-wrap rounded-md border px-3 py-2 text-sm font-medium ${classes[type]}`}>{children}</div>;
}
