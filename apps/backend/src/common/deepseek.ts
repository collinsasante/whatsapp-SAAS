export const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * The only DeepSeek model this app is allowed to call. deepseek-chat (V3) is the
 * cheap, non-reasoning model — deepseek-reasoner (R1) costs far more per token due
 * to its chain-of-thought output and must never be used for these background/
 * per-message calls. Every DeepSeek call site imports this constant instead of
 * hardcoding a model string, so there is exactly one place cost-sensitive model
 * selection can ever change.
 */
export const DEEPSEEK_MODEL = 'deepseek-chat';
