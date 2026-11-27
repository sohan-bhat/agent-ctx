import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { LazyMotion, domAnimation } from "motion/react"
import * as m from "motion/react-m"
import { cn, useReduced } from "@/lib/utils"
import { Slot } from "radix-ui"

const PressSlot = m.create(Slot.Root)
const DOWN = { duration: 0.12, ease: [0.23, 1, 0.32, 1] } as const
const UP = { type: "spring", duration: 0.3, bounce: 0.4 } as const

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-sm border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color,text-decoration-color] duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline: "border-foreground/35 bg-transparent text-foreground hover:border-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent aria-expanded:bg-accent",
        destructive: "text-destructive hover:bg-accent",
        link: "h-auto px-0 font-semibold text-foreground underline decoration-foreground/35 underline-offset-4 hover:decoration-foreground",
      },
      size: {
        default: "h-8 gap-1.5 px-3",
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-4",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<
  React.ComponentProps<"button">,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const still = useReduced()
  const [held, setHeld] = React.useState(false)
  const Comp = asChild ? PressSlot : m.button
  const keyed = (e: React.KeyboardEvent<HTMLButtonElement>) =>
    e.key === "Enter" || (e.key === " " && e.currentTarget.tagName === "BUTTON")

  return (
    <LazyMotion features={domAnimation}>
      <Comp
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        initial={false}
        animate={still ? undefined : { scale: held ? 0.97 : 1 }}
        transition={held ? DOWN : UP}
        onPointerDown={(e) => {
          onPointerDown?.(e)
          setHeld(e.button === 0)
        }}
        onPointerUp={(e) => {
          onPointerUp?.(e)
          setHeld(false)
        }}
        onPointerLeave={(e) => {
          onPointerLeave?.(e)
          setHeld(false)
        }}
        onPointerCancel={(e) => {
          onPointerCancel?.(e)
          setHeld(false)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (keyed(e)) setHeld(true)
        }}
        onKeyUp={(e) => {
          onKeyUp?.(e)
          setHeld(false)
        }}
        onBlur={(e) => {
          onBlur?.(e)
          setHeld(false)
        }}
        {...props}
      />
    </LazyMotion>
  )
}

export { Button, buttonVariants }
