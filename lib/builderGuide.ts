/**
 * The complete builder guide lives in Notion, published to the web, so it can
 * be edited without a deploy and duplicated by the Monad team into their own
 * workspace. The site only ever links to `/guide`, which redirects here: the
 * short path is what goes on event pages and in docs, and it keeps working if
 * the Notion URL changes.
 *
 * Kept in its own module because next.config.ts imports it and should not pull
 * in the rest of the SEO constants at config time.
 */
export const BUILDER_GUIDE_PATH = "/guide";

export const BUILDER_GUIDE_URL =
  "https://nosy-vegetable-b78.notion.site/Monsmith-for-Monad-builders-3d94ab967e4181d899a9d6756523b8fe";
