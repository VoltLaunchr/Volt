"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import type { CSSProperties, ElementType } from "react";
import { memo, useMemo } from "react";

// Pre-built `motion.X` components — static at module load, so React Compiler /
// react-hooks/purity won't flag them as "components created during render".
// To support a new element type, add it here.
const MOTION_ELEMENTS = {
  p: motion.p,
  span: motion.span,
  div: motion.div,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  h4: motion.h4,
  strong: motion.strong,
  em: motion.em,
} as const;
type MotionElementKey = keyof typeof MOTION_ELEMENTS;

const isMotionElementKey = (k: string): k is MotionElementKey =>
  Object.hasOwn(MOTION_ELEMENTS, k);

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  // Look up the prebuilt motion element. Falls back to `motion.p` (the default
  // when `as` is omitted) if the caller passes an unsupported tag.
  const MotionComponent = useMemo(() => {
    const key = typeof Component === "string" ? Component : "p";
    return isMotionElementKey(key) ? MOTION_ELEMENTS[key] : MOTION_ELEMENTS.p;
  }, [Component]);

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  return (
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={{
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
