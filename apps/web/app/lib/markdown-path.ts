/** The Markdown twin of a page path: `/articles` is `/articles.md`, `/articles/a` is `/articles/a.md`. The home page is `/index.md` (see `lib/meta.ts`). Split from `lib/llm-text.ts` so the pages can use it without the formatting. */
export const markdownPath = (path: string) => `${path.replace(/\/+$/, "")}.md`;
/** The site index for language models (https://llmstxt.org; `routes/llms-txt.ts`): what the site is and a link to every twin. */
export const LLMS_TXT_PATH = "/llms.txt";
