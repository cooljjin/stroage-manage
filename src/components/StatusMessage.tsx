import { CircleCheck } from "lucide-react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { reducedStatusMessageMotion, statusMessageMotion, successIconMotion } from "../lib/animations";

type Props = {
  type?: "error" | "info" | "success";
  children: React.ReactNode;
};

export function StatusMessage({ type = "info", children }: Props) {
  const shouldReduceMotion = useReducedMotion();
  const classes = {
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
    info: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
  };
  const motionProps = shouldReduceMotion ? reducedStatusMessageMotion : statusMessageMotion;
  const successIconProps = shouldReduceMotion
    ? { initial: false, animate: undefined, transition: undefined }
    : {
        initial: successIconMotion.initial,
        animate: successIconMotion.animate,
        transition: successIconMotion.transition
      };

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        initial={motionProps.initial}
        animate={motionProps.animate}
        transition={motionProps.transition}
        className={`flex items-start gap-2 whitespace-pre-wrap rounded-md border px-3 py-2 text-sm font-medium ${classes[type]}`}
      >
        {type === "success" ? (
          <m.span
            initial={successIconProps.initial}
            animate={successIconProps.animate}
            transition={successIconProps.transition}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          >
            <CircleCheck size={16} />
          </m.span>
        ) : null}
        <span className="min-w-0 flex-1">{children}</span>
      </m.div>
    </LazyMotion>
  );
}
