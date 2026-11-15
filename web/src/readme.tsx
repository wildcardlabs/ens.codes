import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CodeTicket } from '@/components/ds/CodeTicket'
import { Token } from '@/components/ds/primitives'
import { Bean, Coin, Key, Seal, Spark, Star, Ticky, Vault } from '@/components/ds/stickers'
import { EnsMark, Mark } from '@/components/ds/Wordmark'
import './index.css'

/**
 * The pictures in the repository's README (.github/readme/*.png), drawn with the site's own ticket,
 * stickers and type. Each is a fixed-size frame on a transparent background, in a light and a dark
 * version for GitHub's two themes. To make them again: run the dev server, then
 * `node web/scripts/readme-art.mjs`.
 *
 *   /readme.html?art=banner&theme=dark
 */
const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.classList.toggle('dark', theme === 'dark')
document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'

const CODE = 'Q729F-CPAZZ-KG1MY-6EGGP-3V7TG'

/* ---------------------------------------------------------------- shared */

function Card({ art, title, body, className }: { art: ReactNode; title: ReactNode; body: ReactNode; className?: string }) {
  return (
    <div className={`fragment flex items-center gap-4 px-5 py-4 text-left ${className ?? ''}`}>
      <span className="grid w-14 shrink-0 place-items-center">{art}</span>
      <span className="min-w-0">
        <b className="block font-display text-[19px] font-semibold tracking-[-0.02em] text-foreground">{title}</b>
        <span className="mt-0.5 block text-[14.5px] leading-[20px] text-caption">{body}</span>
      </span>
    </div>
  )
}

/** A labelled connector between two points, drawn in the caption ink. */
function Wire({ d, label, at, dashed, head = true, align = 'middle' }: { d: string; label?: string; at?: [number, number]; dashed?: boolean; head?: boolean; align?: 'start' | 'middle' | 'end' }) {
  return (
    <>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? '2 7' : undefined} markerEnd={head ? 'url(#head)' : undefined} />
      {label && at && (
        <text x={at[0]} y={at[1]} textAnchor={align} className="fill-caption font-mono text-[15px]" style={{ letterSpacing: '-0.01em' }}>
          {label}
        </text>
      )}
    </>
  )
}

function Wires({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="pointer-events-none absolute inset-0 text-caption" aria-hidden="true">
      <defs>
        <marker id="head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M1.5 1.5 7 5l-5.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {children}
    </svg>
  )
}

const UsdcLogo = ({ size = 40 }: { size?: number }) => <img src="/logos/usdc.svg" alt="" width={size} height={size} />
const Ens = () => <EnsMark className="translate-y-0 bg-[#0080BC] text-[40px]" />

/* ---------------------------------------------------------------- banner */

function Banner() {
  return (
    <div className="relative h-[500px] w-[1200px] overflow-hidden rounded-[28px] bg-[var(--pill)] dark:bg-[#1f1e24]">
      <div className="absolute left-[72px] top-[60px] flex items-center gap-[0.36em] font-display text-[30px] font-semibold leading-none tracking-[-0.02em] text-heading">
        <Mark className="h-[1.3em] translate-y-[0.125em] text-gold" />
        <span className="translate-y-px">ens.codes</span>
      </div>
      <div className="absolute left-[72px] top-[164px] w-[600px]">
        <h1 className="font-display text-[76px] font-medium leading-[80px] tracking-[-0.045em] text-heading">Renewals you can hand over.</h1>
        <p className="mt-7 max-w-[560px] text-[24px] font-medium leading-[33px] tracking-[-0.015em] text-body">
          Claim codes for ENS renewals. Pay in USDC, hand the code to anyone, and it renews any <span className="text-heading">.eth</span> name.
        </p>
      </div>
      <div className="absolute right-[84px] top-[132px] w-[420px] rotate-[5deg]">
        <Coin size={88} className="absolute -left-11 -top-11 z-10 -rotate-12" />
        <Bean size={112} className="absolute -bottom-14 -right-10 z-10 rotate-6" />
        <Star size={28} className="absolute -top-11 right-8 text-yellow" />
        <Spark size={24} className="absolute -bottom-11 left-6 text-sky" />
        <CodeTicket amount={25_000000n} qr="https://ens.codes" shimmer={false} />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- journey */

function Journey() {
  const steps = [
    {
      title: 'Buy',
      body: 'Pick an amount and pay in USDC.',
      ticket: <CodeTicket amount={25_000000n} ens={false} shimmer={false} />,
      sticker: <Coin size={50} className="absolute -right-4 -top-4 rotate-12" />,
    },
    {
      title: 'Hand it over',
      body: 'Send the code, a link or the ticket.',
      ticket: <CodeTicket amount={25_000000n} code={CODE} ens={false} shimmer={false} />,
      sticker: <Key size={62} className="absolute -right-5 -top-3 rotate-12" />,
    },
    {
      title: 'Redeem',
      body: 'Renew up to 5 .eth names.',
      ticket: <CodeTicket amount={25_000000n} code={CODE} stamp="Claimed" ens={false} shimmer={false} />,
      sticker: <Bean size={56} className="absolute -right-4 -top-5 rotate-6" />,
    },
  ]
  return (
    <div className="relative grid w-[1200px] grid-cols-3 gap-6 p-1">
      {steps.map((s, i) => (
        <div key={s.title} className="panel flex flex-col p-7 dark:bg-[#1f1e24]">
          <div className="relative mx-auto w-full max-w-[290px]">
            {s.ticket}
            {s.sticker}
          </div>
          <div className="mt-8 flex items-center gap-2.5">
            <Token color="var(--orange)" size={28} className="text-[14px]">
              {i + 1}
            </Token>
            <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">{s.title}</h3>
          </div>
          <p className="mt-2 text-[16.5px] leading-[24px] text-body">{s.body}</p>
        </div>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- money */

function Money() {
  const W = 1200
  const H = 430
  return (
    <div className="panel relative overflow-hidden dark:bg-[#1f1e24]" style={{ width: W, height: H }}>
      <Wires width={W} height={H}>
        <Wire d="M306 215H414" label="value + fee" at={[360, 200]} />
        <Wire d="M714 215H752V96H912" label="renewal price" at={[770, 84]} align="start" />
        <Wire d="M752 215H912" label="refunds" at={[770, 203]} align="start" />
        <Wire d="M752 215V334H912" label="0.05 USDC fees" at={[770, 322]} align="start" />
      </Wires>
      <div className="absolute left-[40px] top-[160px] w-[266px]">
        <Card art={<Key size={50} className="-rotate-12" />} title="The buyer" body="Pays for codes in USDC." />
      </div>
      <div className="absolute left-[414px] top-[146px] w-[300px]">
        <Card className="py-6" art={<Vault size={52} />} title="The vault" body="A contract, not us. Holds each code’s value until it’s used." />
      </div>
      <div className="absolute left-[912px] top-[42px] w-[248px]">
        <Card art={<Ens />} title="ENS" body="When a code is redeemed." />
      </div>
      <div className="absolute left-[912px] top-[160px] w-[248px]">
        <Card art={<UsdcLogo />} title="The buyer" body="Unused codes and change." />
      </div>
      <div className="absolute left-[912px] top-[278px] w-[248px]">
        <Card art={<Coin size={44} />} title="Fee recipient" body="Fixed when deployed." />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- stack */

function Stack() {
  const W = 1200
  const H = 470
  return (
    <div className="panel relative overflow-hidden dark:bg-[#1f1e24]" style={{ width: W, height: H }}>
      <Wires width={W} height={H}>
        {/* The site to either submitter. */}
        <Wire d="M300 245H330V130H362" />
        <Wire d="M330 245V360H362" label="or" at={[342, 306]} align="start" />
        {/* Either submitter to the vault. */}
        <Wire d="M620 130H660V245H692" />
        <Wire d="M620 360H660V245" head={false} />
        {/* The vault to ENS and back to the buyer. */}
        <Wire d="M928 245H950V140H972" />
        <Wire d="M950 245V350H972" label="refund" at={[940, 372]} align="end" />
        {/* Prices read straight from ENS. */}
        <Wire d="M1066 65V36H110V172" label="live prices, through ens-budget" at={[615, 26]} dashed />
      </Wires>
      <div className="absolute left-[40px] top-[180px] w-[260px]">
        <Card art={<Ticky size={52} />} title="The site" body="Prices the names and signs with the code." />
      </div>
      <div className="absolute left-[362px] top-[72px] w-[258px]">
        <Card art={<Seal size={46} />} title="Relayer" body="Sends it for people without a wallet." />
      </div>
      <div className="absolute left-[362px] top-[302px] w-[258px]">
        <Card art={<Key size={50} className="-rotate-12" />} title="A wallet" body="Or sends it directly." />
      </div>
      <div className="absolute left-[692px] top-[180px] w-[236px]">
        <Card art={<Vault size={50} />} title="Vault" body="Checks the code, renews, refunds." />
      </div>
      <div className="absolute left-[972px] top-[65px] w-[188px]">
        <Card className="h-[150px] flex-col items-start justify-center gap-3" art={<Ens />} title="ENS v2" body="Renews the names." />
      </div>
      <div className="absolute left-[972px] top-[275px] w-[188px]">
        <Card className="h-[150px] flex-col items-start justify-center gap-3" art={<UsdcLogo />} title="Buyer" body="Gets back the rest." />
      </div>
    </div>
  )
}

const ART: Record<string, () => ReactNode> = { banner: Banner, journey: Journey, money: Money, stack: Stack }
const Art = ART[params.get('art') ?? 'banner'] ?? Banner

createRoot(document.getElementById('root')!).render(
  <div id="art" className="inline-block p-2">
    <Art />
  </div>,
)
