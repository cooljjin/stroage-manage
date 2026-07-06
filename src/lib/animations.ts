export const animationDurations = {
  fast: 0.16,
  normal: 0.2,
  slow: 0.25
} as const;

export const animationEasings = {
  standard: "easeOut",
  balanced: "easeInOut"
} as const;

export const statusMessageMotion = {
  initial: {
    opacity: 0,
    y: 8
  },
  animate: {
    opacity: 1,
    y: 0
  },
  transition: {
    duration: animationDurations.fast,
    ease: animationEasings.standard
  }
} as const;

export const reducedStatusMessageMotion = {
  initial: {
    opacity: 0
  },
  animate: {
    opacity: 1
  },
  transition: {
    duration: 0.01
  }
} as const;

export const pageTransitionMotion = {
  initial: {
    opacity: 0,
    y: 6
  },
  animate: {
    opacity: 1,
    y: 0
  },
  transition: {
    duration: animationDurations.fast,
    ease: animationEasings.standard
  }
} as const;

export const reducedPageTransitionMotion = {
  initial: {
    opacity: 1
  },
  animate: {
    opacity: 1
  },
  transition: {
    duration: 0.01
  }
} as const;

export const listContainerMotion = {
  animate: {
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.02
    }
  }
} as const;

export const listItemMotion = {
  initial: {
    opacity: 0,
    y: 6
  },
  animate: {
    opacity: 1,
    y: 0
  },
  transition: {
    duration: animationDurations.fast,
    ease: animationEasings.standard
  }
} as const;

export const successIconMotion = {
  initial: {
    opacity: 0,
    scale: 0.8
  },
  animate: {
    opacity: 1,
    scale: 1
  },
  transition: {
    duration: animationDurations.fast,
    ease: animationEasings.standard
  }
} as const;
