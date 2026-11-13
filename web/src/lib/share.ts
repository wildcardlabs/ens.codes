import qrcode from 'qrcode-generator'
import { MARK_BOX, MARK_PATH } from './mark'
import { redeemLink } from './code'
import { SITE_HOST } from './config'
import { fmtUsdc } from './format'

/**
 * A claim code as a picture people can send: the ticket (value, code, where to redeem) with a QR of
 * its redeem link. Drawn on a canvas in the page's own fonts and colours, so it needs no server and
 * no image library.
 */

const W = 1280
const H = 840

/** Printed on the picture. Always the real address, wherever the page is running. */
const REDEEM_AT = `${SITE_HOST}/redeem`

const DISPLAY = '"Plus Jakarta Sans Variable", sans-serif'
const SANS = '"Inter Variable", sans-serif'
const MONO = '"JetBrains Mono Variable", monospace'

function theme() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    paper: v('--background', '#ffffff'),
    stone: v('--stone', '#f2ebe0'),
    heading: v('--heading', '#343433'),
    ink: v('--foreground', '#121212'),
    caption: v('--caption', '#848281'),
    gold: v('--gold', '#ca9230'),
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

const marks = new Map<string, Promise<HTMLImageElement | null>>()
const ensMark = (color: string) => marks.get(color) ?? marks.set(color, loadEnsMark(color)).get(color)!

/** ENS's mark in the given colour, as an image ready to draw. Null if it can't be loaded. */
async function loadEnsMark(color: string): Promise<HTMLImageElement | null> {
  try {
    const svg = (await (await fetch('/logos/ens.svg')).text()).replace(/fill="#[0-9A-Fa-f]{3,8}"/g, `fill="${color}"`)
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}

/** `number`, when given, is printed small in the corner: the code's number in My codes. */
async function draw(code: string, amount: bigint, number?: number): Promise<HTMLCanvasElement> {
  // Canvas text uses the page's fonts only once they have loaded at these weights.
  await Promise.all([`600 44px ${DISPLAY}`, `500 150px ${DISPLAY}`, `600 30px ${SANS}`, `400 28px ${SANS}`, `500 40px ${MONO}`].map((f) => document.fonts.load(f)))
  const c = theme()
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.textBaseline = 'alphabetic'

  // Paper, then the ticket with its two punched notches.
  ctx.fillStyle = c.paper
  ctx.fillRect(0, 0, W, H)
  const x = 40
  const y = 40
  const w = W - 80
  const h = H - 80
  ctx.fillStyle = c.stone
  roundRect(ctx, x, y, w, h, 44)
  ctx.fillStyle = c.paper
  for (const cx of [x, x + w]) {
    ctx.beginPath()
    ctx.arc(cx, y + h / 2, 52, 0, Math.PI * 2)
    ctx.fill()
  }

  const left = x + 80
  const right = x + w - 80

  // Wordmark: the mark, then the name.
  ctx.save()
  // The mark, 76px across, its left edge on the margin and its middle level with the name's lowercase
  // letters. Its eyes are holes, so the ticket's paper shows through.
  const k = 76 / MARK_BOX.width
  ctx.translate(left - MARK_BOX.x * k, 133 - (MARK_BOX.y + MARK_BOX.height / 2) * k)
  ctx.scale(k, k)
  ctx.fillStyle = c.heading
  ctx.fill(new Path2D(MARK_PATH), 'evenodd')
  ctx.restore()
  ctx.fillStyle = c.heading
  ctx.font = `600 44px ${DISPLAY}`
  ctx.fillText('ens.codes', left + 76 + 10, 146)

  const ens = await ensMark(c.heading)
  if (ens) ctx.drawImage(ens, right - 42, 106, 42, (42 * 231) / 202)

  ctx.fillStyle = c.gold
  ctx.font = `600 30px ${SANS}`
  ctx.fillText('Claim code for ENS renewals', left, 352)
  ctx.fillStyle = c.heading
  ctx.font = `500 150px ${DISPLAY}`
  ctx.letterSpacing = '-6px'
  ctx.fillText(fmtUsdc(amount), left - 6, 492)
  ctx.letterSpacing = '0px'

  // QR of the redeem link, on its own white tile. Dark on white whatever the theme, so it scans.
  const qr = qrcode(0, 'M')
  qr.addData(redeemLink(code))
  qr.make()
  const n = qr.getModuleCount()
  const size = 250
  const qx = right - size
  const qy = 242
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, qx - 18, qy - 18, size + 36, size + 36, 20)
  ctx.fillStyle = '#121212'
  const cell = size / n
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect(qx + col * cell, qy + r * cell, cell + 0.5, cell + 0.5)

  // The code on its white strip.
  ctx.fillStyle = c.paper
  roundRect(ctx, left, 572, right - left, 100, 14)
  ctx.fillStyle = c.ink
  ctx.font = `500 40px ${MONO}`
  ctx.letterSpacing = '1.6px'
  ctx.textAlign = 'center'
  ctx.fillText(code, (left + right) / 2, 636)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = c.caption
  ctx.font = `400 28px ${SANS}`
  ctx.fillText(`Redeem at ${REDEEM_AT}`, (left + right) / 2, 734)
  if (number !== undefined) {
    ctx.textAlign = 'right'
    ctx.fillText(`No. ${number}`, right, 734)
  }
  ctx.textAlign = 'start'
  return canvas
}

/**
 * The canvas as file bytes. `toDataURL` encodes on the spot; `canvas.toBlob` waits for the browser
 * to be idle, which can take a second per picture and adds up over a batch.
 */
function encode(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Uint8Array<ArrayBuffer> {
  const data = atob(canvas.toDataURL(type, quality).split(',')[1])
  const bytes = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i)
  return bytes
}

export async function ticketPng(code: string, amount: bigint): Promise<Blob> {
  return new Blob([encode(await draw(code, amount), 'image/png')], { type: 'image/png' })
}

/** The same picture as raw bytes, with the code's number on it: for a ZIP of many. */
export const ticketPngBytes = async (code: string, amount: bigint, number: number) => encode(await draw(code, amount, number), 'image/png')

/** A file name that tells codes apart without spelling the whole code out. */
export const ticketName = (code: string) => `ens-code-${code.slice(0, 5)}.png`

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const downloadTicketPng = async (code: string, amount: bigint) => download(await ticketPng(code, amount), ticketName(code))

/**
 * Phones and tablets: the system share sheet can take the picture, so Share goes straight to it.
 * Desktop browsers get plain buttons instead (download the image, print, copy the link).
 */
export function hasShareSheet(): boolean {
  if (!matchMedia('(pointer: coarse)').matches || !navigator.canShare) return false
  try {
    return navigator.canShare({ files: [new File([], 'x.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

/** Open the share sheet with the ticket picture and the redeem link. Resolves false if dismissed. */
export async function shareTicket(code: string, amount: bigint): Promise<boolean> {
  const file = new File([await ticketPng(code, amount)], ticketName(code), { type: 'image/png' })
  try {
    await navigator.share({ files: [file], title: `${fmtUsdc(amount)} ENS claim code`, text: redeemLink(code) })
    return true
  } catch (err) {
    if ((err as Error).name === 'AbortError') return false
    throw err
  }
}
