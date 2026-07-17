import { m, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";

type PressableButtonProps = HTMLMotionProps<"button"> & {
  surfaceFeedback?: boolean;
};

export function PressableButton({ className = "", disabled, surfaceFeedback = true, ...props }: PressableButtonProps) {
  const shouldReduceMotion = useReducedMotion();
  const pressMotion = disabled || shouldReduceMotion
    ? undefined
    : surfaceFeedback
      ? {
        scale: 0.975,
        backgroundColor: "rgba(241, 245, 249, 0.92)",
        borderColor: "rgb(226, 232, 240)",
        boxShadow: "inset 0 0 0 1px rgba(148, 163, 184, 0.22)"
      }
      : {
        scale: 0.975
      };

  return (
    <m.button
      {...props}
      disabled={disabled}
      whileTap={pressMotion}
      transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.55 }}
      className={`border border-transparent will-change-transform ${className}`}
    />
  );
}
