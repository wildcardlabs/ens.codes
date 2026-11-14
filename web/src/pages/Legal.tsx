import type { ReactNode } from 'react'
import privacy from '@/legal/privacy.md?raw'
import terms from '@/legal/terms.md?raw'

/**
 * The Terms of Use and the Privacy Policy. Their text lives in src/legal as plain Markdown, so it
 * can be read and revised as a document; this draws the few things those files use: a title,
 * numbered sections, paragraphs, lists, bold lead-ins and email addresses.
 */
const DOCS = { terms, privacy }

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/

function inline(text: string): ReactNode[] {
  return text.split(new RegExp(`(\\*\\*[^*]+\\*\\*|${EMAIL.source})`, 'g')).map((part, i) =>
    part.startsWith('**') ? (
      <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : EMAIL.test(part) && part.match(EMAIL)?.[0] === part ? (
      <a key={i} href={`mailto:${part}`} className="t-link">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

export default function Legal({ doc }: { doc: keyof typeof DOCS }) {
  const blocks = DOCS[doc].trim().split(/\n{2,}/)
  return (
    <article className="max-w-[720px] text-[16px] leading-[26px] text-body">
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        if (block.startsWith('# ')) return <h1 key={i} className="t-page">{block.slice(2)}.</h1>
        if (block.startsWith('## ')) return <h2 key={i} className="mt-10 text-[19px] font-semibold tracking-[-0.02em] text-foreground">{block.slice(3)}</h2>
        if (block.startsWith('Last updated')) return <p key={i} className="mt-2 text-[14px] text-caption">{block}</p>
        if (lines.every((l) => l.startsWith('- ')))
          return (
            <ul key={i} className="mt-4 grid list-disc gap-2 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          )
        return (
          <p key={i} className="mt-4">
            {lines.map((l, j) => (
              <span key={j} className="block">
                {inline(l)}
              </span>
            ))}
          </p>
        )
      })}
    </article>
  )
}
