import { ChevronLeft, ChevronRight } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * A strip that scrolls sideways when its content doesn't fit, and says so: a small arrow button
 * appears on whichever side has more to see. Nothing shows when everything fits.
 *
 * `arrows` positions the buttons vertically ("top-1.5" to sit on a table's header row; centred by
 * default).
 */
export function ScrollX({
  className,
  arrows = "top-1/2 -translate-y-1/2",
  children,
  ...props
}: React.ComponentProps<"div"> & { arrows?: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ left: false, right: false })

  const measure = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener("scroll", measure)
      ro.disconnect()
    }
  }, [measure])

  const nudge = (dir: 1 | -1) =>
    ref.current?.scrollBy({ left: dir * Math.max(120, ref.current.clientWidth * 0.6), behavior: "smooth" })

  const arrow = "lift absolute z-10 grid size-7 place-items-center rounded-md bg-background text-foreground"
  return (
    <div className="relative min-w-0">
      <div ref={ref} className={cn("overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)} {...props}>
        {children}
      </div>
      {edges.left && (
        <button type="button" aria-label="Scroll left" className={cn(arrow, "left-1.5", arrows)} onClick={() => nudge(-1)}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
      )}
      {edges.right && (
        <button type="button" aria-label="Scroll right" className={cn(arrow, "right-1.5", arrows)} onClick={() => nudge(1)}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
