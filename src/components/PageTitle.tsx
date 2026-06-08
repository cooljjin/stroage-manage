type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function PageTitle({ title, description, action }: Props) {
  return (
    <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-normal">{title}</h1>
        {description ? <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
