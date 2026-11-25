/**
 * The AI crawlers `robots.txt` names, and what each is for (#750). One table: flipping a bot is one line here, and the file, its comment
 * and the tests follow.
 *
 * - `training`: collects pages to train a model. Disallowed: the owner's writing, artwork and photographs are all-rights-reserved
 *   (`lib/copyright.ts`), and nothing is gained by being in a training set.
 * - `search`: builds the index an AI search product answers from, and links back to the page. Allowed: this is how the site is found.
 * - `agent`: fetches a page because a person asked an assistant about it, right now. Allowed.
 *
 * `robots.txt` is a request that well-behaved crawlers honour, not a barrier: it says nothing to a scraper that ignores it. What must not
 * be read is not published (docs/llm-access.md).
 */
export type CrawlerPurpose = "training" | "search" | "agent";

export interface AiCrawler {
  /** The `User-agent` token, as the operator documents it (matched case-insensitively by crawlers). */
  token: string;
  operator: string;
  purpose: CrawlerPurpose;
}

export const AI_CRAWLERS: readonly AiCrawler[] = [
  { token: "GPTBot", operator: "OpenAI", purpose: "training" },
  { token: "ClaudeBot", operator: "Anthropic", purpose: "training" },
  { token: "anthropic-ai", operator: "Anthropic (former token)", purpose: "training" },
  // A control token, not a crawler: it only tells Google whether Gemini may use the pages. Search is a different agent (Googlebot), left alone.
  { token: "Google-Extended", operator: "Google", purpose: "training" },
  { token: "Applebot-Extended", operator: "Apple", purpose: "training" },
  { token: "CCBot", operator: "Common Crawl", purpose: "training" },
  { token: "Bytespider", operator: "ByteDance", purpose: "training" },
  { token: "meta-externalagent", operator: "Meta", purpose: "training" },
  { token: "FacebookBot", operator: "Meta", purpose: "training" },
  { token: "Amazonbot", operator: "Amazon", purpose: "training" },
  { token: "Diffbot", operator: "Diffbot", purpose: "training" },
  { token: "omgili", operator: "Webz.io", purpose: "training" },
  { token: "omgilibot", operator: "Webz.io", purpose: "training" },
  { token: "ImagesiftBot", operator: "Hive", purpose: "training" },
  { token: "OAI-SearchBot", operator: "OpenAI", purpose: "search" },
  { token: "Claude-SearchBot", operator: "Anthropic", purpose: "search" },
  { token: "PerplexityBot", operator: "Perplexity", purpose: "search" },
  { token: "DuckAssistBot", operator: "DuckDuckGo", purpose: "search" },
  { token: "ChatGPT-User", operator: "OpenAI", purpose: "agent" },
  { token: "Claude-User", operator: "Anthropic", purpose: "agent" },
  { token: "Perplexity-User", operator: "Perplexity", purpose: "agent" },
  { token: "MistralAI-User", operator: "Mistral", purpose: "agent" },
  { token: "Meta-ExternalFetcher", operator: "Meta", purpose: "agent" },
];

export const crawlersFor = (purpose: CrawlerPurpose): AiCrawler[] => AI_CRAWLERS.filter((c) => c.purpose === purpose);
