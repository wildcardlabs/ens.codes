import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

/**
 * A QR code on its own white tile. Always dark on white, whatever the theme: that is what every
 * scanner reads.
 */
export function Qr({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { size: n, path: d }
  }, [value])
  return (
    <span className={cn('block bg-white', className)}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="block size-full">
        <path d={path} fill="#121212" />
      </svg>
    </span>
  )
}
