# Language models and crawlers (#750)

What the site says to AI crawlers and agents, and what it gives them to read. Written 2026-11-24, after an audit of the live site (issue #751 holds the open decisions about what the public data exposes).

## Policy: `robots.txt`

One table, `apps/web/app/lib/ai-crawlers.ts`; `lib/sitemap.ts` (`robotsTxt`) turns it into the file. Each crawler has a purpose:

| Purpose | Today | Why |
| --- | --- | --- |
| `training` (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Bytespider, meta-externalagent...) | `Disallow: /` | The writing, artwork and photographs are all rights reserved (`lib/copyright.ts`). |
| `search` (OAI-SearchBot, Claude-SearchBot, PerplexityBot, DuckAssistBot) | allowed | They index the site so an answer can link back to it. |
| `agent` (ChatGPT-User, Claude-User, Perplexity-User, ...) | allowed | A person asked an assistant about a page, right now. |

To change a bot, change its `purpose` (or add a row) and nothing else. Ordinary search engines (Googlebot, Bingbot) are not in the table and are never named: `Google-Extended` only tells Google whether Gemini may use the pages, Search is unaffected. Every non-production host stays `Disallow: /` for everyone.

**`robots.txt` is a request, not a barrier.** Well-behaved crawlers obey it; a scraper that ignores it is not stopped. Anything that must not be read must not be published: see "What the twins leave out" and issue #751.

## Reading: `/llms.txt` and the Markdown twins

- `/llms.txt` ([llmstxt.org](https://llmstxt.org)): what the site is, then a link to the Markdown twin of every entry (with its one-line summary), the lists and the career page; the places are under "Optional".
- `<address>.md` is the plain Markdown of a page: `/locations/<slug>.md`, `/<section>/<slug>.md` (articles, software, artworks, poetry, photography), `/<section>.md`, `/career.md`. One loader (`routes/markdown.ts`, registered under each address in `routes.ts`), pure formatting in `lib/llm-text.ts`. An unknown address is a 404.
- Every such page carries `<link rel="alternate" type="text/markdown" href="...md">` (`pageMeta`'s `markdown` flag), so an agent that got the HTML finds the twin.

The twins say what the HTML page says (same fields, same copyright notice) and nothing more.

### What the twins leave out

- **Coordinates.** A model reading a place does not need a point, and a file of every point is what a scraper wants.
- **The images of a `sensitive` entry**, alt text included: the page blurs them until the visitor asks.
- Anything the contract has no field for (no email, phone or address exists in the data, `packages/schemas`).

### Not done

- `Accept: text/markdown` on the HTML address (content negotiation): it needs `Vary: Accept` on every page, which fragments the CDN cache. The `.md` address and the `alternate` link cover agents that read the HTML first.
- Rate limiting of unidentified scrapers: a Vercel WAF rule (see `docs/api-cost-and-abuse.md`), set in the dashboard, not in this repo.
