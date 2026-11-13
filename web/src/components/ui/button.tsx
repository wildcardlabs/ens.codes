import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/**
 * Primary is always near-black, secondary ("soft") is always beige. Corners are tight (8px), not
 * pills. Never colour a primary button and never add a gradient.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-pill border-0 font-sans font-medium tracking-[-0.03em] whitespace-nowrap transition-colors duration-100 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-foreground",
        soft: "bg-pill text-foreground hover:bg-pill-hover aria-expanded:bg-pill-hover",
        secondary: "bg-pill text-foreground hover:bg-pill-hover aria-expanded:bg-pill-hover",
        outline: "ringed text-foreground hover:bg-card aria-expanded:bg-card",
        ghost: "text-foreground hover:bg-pill aria-expanded:bg-pill",
        destructive: "bg-pill text-red hover:bg-pill-hover",
        link: "h-auto rounded-none p-0 t-link",
      },
      size: {
        default: "h-8 gap-2 px-3.5 text-[15px]",
        sm: "h-7 gap-1.5 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-10 gap-2 px-5 text-[15px]",
        lg: "h-12 gap-[11px] pr-6 pl-5 text-[17px] tracking-[-0.01em] [&_svg:not([class*='size-'])]:size-5",
        icon: "size-8",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * forwardRef on purpose: this project is on React 18, where a component only receives a ref this
 * way. Menus, tooltips and dialogs that use a Button as their trigger (`asChild`) need that ref to
 * know where to open. Without it they render off-screen.
 */
const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
    }
>(function Button({ className, variant = "default", size = "default", asChild = false, type, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref}
      // A bare <button> inside a form submits it; default to "button" unless told otherwise.
      type={asChild ? type : (type ?? "button")}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})

export { Button, buttonVariants }
