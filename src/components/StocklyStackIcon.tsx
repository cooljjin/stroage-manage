import { motion, useReducedMotion } from "motion/react";

type Props = {
  open: boolean;
  className?: string;
};

const springTransition = {
  type: "spring",
  stiffness: 520,
  damping: 34,
  mass: 0.65
} as const;

const layerClassName = "pointer-events-none absolute inset-0 h-full w-full select-none object-contain";

export function StocklyStackIcon({ open, className }: Props) {
  const shouldReduceMotion = useReducedMotion();
  const transition = shouldReduceMotion ? { duration: 0 } : springTransition;

  return (
    <span aria-hidden="true" className={`relative inline-block overflow-visible ${className ?? ""}`}>
      <motion.img
        src="/stockly-stack-bottom.png"
        alt=""
        className={layerClassName}
        draggable={false}
        initial={false}
        animate={open ? { x: -1, y: 5, scale: 1.04 } : { x: -1, y: -2, scale: 1.04 }}
        style={{ transformOrigin: "50% 68%" }}
        transition={transition}
      />
      <motion.img
        src="/stockly-stack-middle.png"
        alt=""
        className={layerClassName}
        draggable={false}
        initial={false}
        animate={open ? { y: -6, scale: 1.03 } : { y: -7 }}
        style={{ transformOrigin: "50% 58%" }}
        transition={transition}
      />
      <motion.img
        src="/stockly-stack-top.png"
        alt=""
        className={layerClassName}
        draggable={false}
        initial={false}
        animate={open ? { x: -1, y: -12 } : { x: -1, y: -9 }}
        style={{ transformOrigin: "50% 46%" }}
        transition={transition}
      />
    </span>
  );
}
