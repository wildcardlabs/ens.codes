import { redeemLink } from './code'
import { ticketPngBytes } from './share'

/**
 * Taking many codes out of the page at once: a spreadsheet, or a ZIP of ticket pictures. The
 * printable vouchers are a print layout (see `ExportCodes.tsx`), not a file made here.
 *
 * Every export carries the code's number, the same one My codes shows, so a printed card or a
 * picture can be matched to its row later (to cancel a lost one, say).
 */
export type ExportItem = {
  /** This wallet's code number: 1 for the first code it ever bought. */
  number: number
  code: string
  amount: bigint
  /** My codes knows these; a fresh purchase doesn't need them. */
  status?: string
  renewed?: string
  /** The day it was bought, as YYYY-MM-DD. */
  bought?: string
}

/** USDC units as a plain decimal: 25000000 -> "25", 12345678 -> "12.345678". */
const plain = (micro: bigint) => {
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${micro / 1_000_000n}.${frac}` : `${micro / 1_000_000n}`
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** One row per code. Columns that no code has a value for are left out. */
export function csvOf(items: ExportItem[]): string {
  const cols: [string, (i: ExportItem) => string][] = [
    ['number', (i) => String(i.number)],
    ['code', (i) => i.code],
    ['redeem_link', (i) => redeemLink(i.code)],
    ['amount_usdc', (i) => plain(i.amount)],
  ]
  if (items.some((i) => i.status)) cols.push(['status', (i) => i.status ?? ''])
  if (items.some((i) => i.renewed)) cols.push(['renewed', (i) => i.renewed ?? ''])
  if (items.some((i) => i.bought)) cols.push(['bought', (i) => i.bought ?? ''])
  return [cols.map(([name]) => name), ...items.map((i) => cols.map(([, get]) => cell(get(i))))].map((r) => r.join(',')).join('\n')
}

/** "037" when the largest number has three digits: files then sort in order in any folder view. */
export function padded(number: number, items: ExportItem[]): string {
  const width = Math.max(3, String(items.reduce((m, i) => Math.max(m, i.number), 0)).length)
  return String(number).padStart(width, '0')
}

/** One picture per code, named by its number, plus the spreadsheet that says which is which. */
export async function imagesZip(items: ExportItem[], onProgress: (done: number) => void): Promise<Blob> {
  const files: ZipFile[] = [{ name: 'ens-codes.csv', bytes: new TextEncoder().encode(csvOf(items)) }]
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    files.push({ name: `ens-code-${padded(item.number, items)}.png`, bytes: await ticketPngBytes(item.code, item.amount, item.number) })
    onProgress(i + 1)
    // Let the page repaint between pictures, so the progress text moves.
    await new Promise((r) => setTimeout(r))
  }
  return zip(files)
}

// ------------------------------------------------------------------------------------------ zip

type ZipFile = { name: string; bytes: Uint8Array }

const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * A ZIP archive with the files stored as they are. PNGs are already compressed, so squeezing them
 * again would save almost nothing and would need a compression library.
 */
function zip(files: ZipFile[]): Blob {
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = new TextEncoder().encode(f.name)
    const crc = crc32(f.bytes)
    // Shared by the file's own header and its directory entry: version, flags (UTF-8 names), no
    // compression, time, date, checksum, size twice (stored size equals real size), name length.
    const common = new Uint8Array(26)
    const c = new DataView(common.buffer)
    c.setUint16(0, 20, true)
    c.setUint16(2, 0x0800, true)
    c.setUint16(4, 0, true)
    c.setUint16(6, time, true)
    c.setUint16(8, date, true)
    c.setUint32(10, crc, true)
    c.setUint32(14, f.bytes.length, true)
    c.setUint32(18, f.bytes.length, true)
    c.setUint16(22, name.length, true)
    c.setUint16(24, 0, true)

    const local = new Uint8Array(4)
    new DataView(local.buffer).setUint32(0, 0x04034b50, true)
    parts.push(local, common, name, f.bytes)

    const entry = new Uint8Array(46)
    const e = new DataView(entry.buffer)
    e.setUint32(0, 0x02014b50, true)
    e.setUint16(4, 20, true)
    entry.set(common, 6)
    e.setUint32(42, offset, true)
    directory.push(entry, name)

    offset += 4 + common.length + name.length + f.bytes.length
  }
  const size = directory.reduce((n, d) => n + d.length, 0)
  const end = new Uint8Array(22)
  const v = new DataView(end.buffer)
  v.setUint32(0, 0x06054b50, true)
  v.setUint16(8, files.length, true)
  v.setUint16(10, files.length, true)
  v.setUint32(12, size, true)
  v.setUint32(16, offset, true)
  return new Blob([...parts, ...directory, end] as BlobPart[], { type: 'application/zip' })
}
