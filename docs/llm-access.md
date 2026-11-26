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
- `<address>.md` is the plain Markdown of a page: `/locations/<slug>.md`, `/<section>/<slug>.md` (articles, software, artworks, poetry, photography), `/<section>.md`, `/career.md`, and `/index.md` for the home page (the text of `/llms.txt`). One loader (`routes/markdown.ts`, registered under each address in `routes.ts`), pure formatting in `lib/llm-text.ts`. An unknown address is a 404.
- A twin has the page's metadata, its text, the cover image when the entry has one (unless it is `sensitive`) and links to its related, previous and next entries (their twins). It is sent `X-Robots-Tag: noindex` and `Link: <page>; rel="canonical"`, so search engines keep the HTML page as the one that is indexed; assistants that fetch it for a person still read it.
- **A visible link on each page**, "This page in Markdown" (`MarkdownLink`, `components/markdown-link.tsx`), in the site footer (`components/site-footer.tsx`, under "For agents") of every page that has a twin: the lists, the career page, an entry, a place (in the side panel the footer is its short form, the links for agents only). Beside it, "Site map (llms.txt)" links `/llms.txt`. Real text in the HTML, so tools that turn HTML into text keep it; text hidden from people and left for bots would be cloaking, so there is none. The home page has no footer and no such link (it has the `alternate` link and the header). Every twin ends with `Site index: <origin>/llms.txt`, so an agent that landed on one page finds the rest.
- Every such page, the home page included, carries `<link rel="alternate" type="text/markdown" href="...md">` (`pageMeta`'s `markdown` flag), so an agent that got the HTML finds the twin. Every response but the static assets also has `Link: </llms.txt>; rel="describedby"` (`headers` in `apps/web/vercel.json`, not the app: the prerendered pages never pass through the server), for agents that read the headers and not the markup.
- **`Accept: text/markdown`** on a page address is redirected (307) to its twin (`redirects` in `apps/web/vercel.json`, header condition on `Accept`), with `Vary: Accept` on every page. A rewrite was tried first and does not work: the single React Router function sees the original path and renders the HTML again. The HTML is `private, no-cache` and a 307 is not cached, so no shared cache holds two versions of one address. Not available on the dev server (a Vercel rewrite): use the `.md` address there.

The twins say what the HTML page says (same fields, same copyright notice) and nothing more.

### What the twins leave out

- **Coordinates.** A model reading a place does not need a point, and a file of every point is what a scraper wants.
- **The images of a `sensitive` entry**, alt text included: the page blurs them until the visitor asks.
- Anything the contract has no field for (no email, phone or address exists in the data, `packages/schemas`).

### Not done

- Rate limiting of unidentified scrapers: a Vercel WAF rule (see `docs/api-cost-and-abuse.md`), set in the dashboard, not in this repo.
