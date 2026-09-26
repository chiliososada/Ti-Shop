# GEO (answer-engine optimization) — 2026-09-27

GEO makes the catalog easy for AI search and assistants (ChatGPT search,
Perplexity, Copilot, Claude, Gemini) to crawl, understand and cite. The live
pages stay the source of truth; everything below is generated from the
published catalog, so prices and stock stay current after every price-list
sync.

## What is in place

| Piece | Where | Notes |
|---|---|---|
| AI crawler access | `src/app/robots.ts`, `src/lib/ai-crawlers.ts` | Explicit groups for OAI-SearchBot, ChatGPT-User, GPTBot, Claude-SearchBot, Claude-User, ClaudeBot, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, Amazonbot, DuckAssistBot, MistralAI-User, meta-externalagent and CCBot, with the same disallows as `*`. |
| `/llms.txt` | `src/app/llms.txt/route.ts`, `src/lib/llms-text.ts` | [llmstxt.org](https://llmstxt.org) map: summary, key facts, categories, every material with price range, guides, policies. |
| `/llms-full.txt` | `src/app/llms-full.txt/route.ts` | Every presentation with box, per-vial and per-mg price, code and availability; material FAQs; blog guides; site FAQ. |
| Material hubs | `src/app/(storefront)/research-materials/[slug]/page.tsx`, `src/lib/material-hubs.ts` | One page per material with 2+ published strengths (47 today). Definition sentence, price table, "At a glance", data-driven FAQ. A family with one strength redirects (308) to its product page. |
| Product-page answers | `src/app/(storefront)/products/[id]/page.tsx` | Product code, material type, classification, aliases, link to the hub, FAQ (price, code, other strengths, availability). |
| Category answers | `src/app/(storefront)/categories/[slug]/page.tsx` | Page 1 lists the category's materials with strengths and lowest price, plus a FAQ. |
| Structured data | `src/components/JsonLd.tsx` | Organization (logo, areaServed, knowsAbout), WebSite with SearchAction (`/products?q=` filters server-side), hub CollectionPage with Product/Offer items, FAQPage on hubs, products and categories. |

Both `.txt` files are `text/plain`, cached for an hour and sent with
`X-Robots-Tag: noindex` so they never compete with the real pages in search.

## Material facts

`src/data/material-facts.json` holds the identity labels shown on hubs and
product pages (material type, classification, aliases, noun, licensed-active
flag), keyed by the price-list family name. It was exported on 2026-09-26 from
the reviewed PureForm material profiles; only these short labels are shared,
no profile prose. `src/lib/material-hubs.test.ts` fails when a catalog family
has no entry, so a new family from the price list needs one added by hand.

## Writing rules

Generated sentences use data only: strengths, product codes, prices, stock,
box size. The test scans every generated hub, product and category answer and
the llms files for dosing, administration, human-use, therapy, weight-loss,
safety, reconstitution and PubMed wording. Keep new templates inside those
rules; no disease or outcome claims.

## Verify

```bash
npx vitest run src/lib/material-hubs.test.ts src/app/robots.test.ts src/app/sitemap.test.ts src/components/JsonLd.test.ts
```

`npm run test:seo` (after a production build) also checks that the
SearchAction points at a working search, robots.txt has the AI groups, both
llms files are served correctly and every llms link is a sitemap URL.

After deploying new or changed pages, `npm run seo:indexnow` notifies Bing and
the other IndexNow engines (ChatGPT search and Copilot use Bing's index).
