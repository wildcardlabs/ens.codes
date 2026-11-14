/**
 * What search engines and link previews are told about the site: each page's title and description,
 * and the questions on the landing page. Nothing here imports anything, because the build reads it
 * too (vite.config.ts writes these into each page's HTML) and the app uses it once it is running.
 */
export const SITE_URL = 'https://ens.codes'
export const SITE_NAME = 'ens.codes'

/** Where else the project lives. */
export const GITHUB_URL = 'https://github.com/wildcardlabs/ens.codes'
export const X_HANDLE = 'enscodes'
export const X_URL = `https://x.com/${X_HANDLE}`

export type PageKey = 'home' | 'buy' | 'redeem' | 'codes' | 'dashboard' | 'terms' | 'privacy'
export type PageMeta = { path: string; title: string; description: string; /** False: kept out of search results. */ index: boolean }

const ABOUT = 'Buy a claim code with USDC and hand it to anyone. They redeem it to renew any .eth name, no wallet needed. A code only ever pays for ENS renewals.'

export const PAGES: Record<PageKey, PageMeta> = {
  home: { path: '/', title: `Claim codes for ENS renewals | ${SITE_NAME}`, description: ABOUT, index: true },
  buy: {
    path: '/buy',
    title: `Buy a claim code for ENS renewals | ${SITE_NAME}`,
    description: 'Put USDC on a claim code, or on up to 200 at once, and hand them out. Each one renews any .eth name.',
    index: true,
  },
  redeem: {
    path: '/redeem',
    title: `Redeem a claim code | ${SITE_NAME}`,
    description: 'Have a claim code? Enter it and choose the .eth names it should renew.',
    index: true,
  },
  codes: { path: '/codes', title: `My codes | ${SITE_NAME}`, description: 'The claim codes bought with your wallet.', index: false },
  dashboard: { path: '/dashboard', title: `Dashboard | ${SITE_NAME}`, description: ABOUT, index: false },
  terms: { path: '/terms', title: `Terms of Use | ${SITE_NAME}`, description: `The terms that apply to using ${SITE_NAME}.`, index: true },
  privacy: { path: '/privacy', title: `Privacy Policy | ${SITE_NAME}`, description: `What ${SITE_NAME} does with information when you use it.`, index: true },
}

/** The landing page's questions, also given to search engines as they are. */
export const QUESTIONS: [string, string][] = [
  ['Who can use a code?', 'Anyone who has it, once. It can only pay for ENS renewals.'],
  ['Can I see my codes again later?', 'Yes. Log in with the wallet you paid with and they’re all in My codes.'],
  ['Does a code expire?', 'No.'],
  ['Can I get my money back?', 'Yes, if the code hasn’t been used. The service fee isn’t refunded.'],
  ['Which wallets work?', 'Browser wallets such as MetaMask and Rabby, including with a Ledger or Trezor.'],
]

export const urlOf = (page: PageMeta) => SITE_URL + (page.path === '/' ? '/' : page.path)

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The site and its questions as schema.org data, for the landing page. */
function structuredData(): string {
  const data = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
    { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/`, logo: `${SITE_URL}/logo.png`, sameAs: [X_URL, GITHUB_URL] },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: QUESTIONS.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
    },
  ]
  // "<" is escaped so nothing in the data can end the script element.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

/** The tags that differ from page to page, as HTML for the document's head. */
export function headTags(key: PageKey): string {
  const page = PAGES[key]
  const url = urlOf(page)
  return [
    `<title>${attr(page.title)}</title>`,
    `<meta name="description" content="${attr(page.description)}" />`,
    page.index ? `<link rel="canonical" href="${url}" />` : '<meta name="robots" content="noindex, nofollow" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${attr(page.title)}" />`,
    `<meta property="og:description" content="${attr(page.description)}" />`,
    `<meta property="og:image" content="${SITE_URL}/og.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="A claim code ticket for ENS renewals, beside the words: Renewals you can hand over." />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:site" content="@${X_HANDLE}" />`,
    ...(key === 'home' ? [structuredData()] : []),
  ].join('\n    ')
}
