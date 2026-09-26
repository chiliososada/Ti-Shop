/**
 * AI search, assistant and training crawlers that are explicitly allowed the
 * same public paths as every other crawler. Listing them makes the intent
 * unambiguous for engines that look for their own user-agent group.
 */
export const AI_CRAWLER_USER_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "DuckAssistBot",
  "MistralAI-User",
  "meta-externalagent",
  "CCBot",
] as const;
