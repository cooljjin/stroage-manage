import type { ReactNode } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { listContainerMotion, listItemMotion } from "../lib/animations";

type AnimatedListProps = Omit<HTMLMotionProps<"div">, "animate" | "initial" | "transition" | "variants"> & {
  children: ReactNode;
};

export function AnimatedList({ children, ...props }: AnimatedListProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <LazyMotion features={domAnimation}>
      <m.div {...props} initial={false} animate={shouldReduceMotion ? undefined : "animate"} variants={shouldReduceMotion ? undefined : listContainerMotion}>
        {children}
      </m.div>
    </LazyMotion>
  );
}

export function AnimatedListItem({ children, ...props }: AnimatedListProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <m.div
      {...props}
      initial={shouldReduceMotion ? false : listItemMotion.initial}
      animate={shouldReduceMotion ? undefined : listItemMotion.animate}
      transition={shouldReduceMotion ? undefined : listItemMotion.transition}
    >
      {children}
    </m.div>
  );
}
