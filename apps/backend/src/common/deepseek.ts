export const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * The only DeepSeek model this app is allowed to call.
 *
 * IMPORTANT: DeepSeek retired the old deepseek-chat / deepseek-reasoner names in
 * favor of deepseek-v4-flash (cheap, general-purpose -- ~$0.14/$0.28 per Mtok) and
 * deepseek-v4-pro (reasoning, ~3x the price on both input and output). This constant
 * previously still said 'deepseek-chat', and DeepSeek appears to have started
 * routing that legacy alias to the new pro-tier default -- which silently 3x'd real
 * spend despite this being the one locked call site every request goes through.
 *
 * Always use the current cheap-tier identifier explicitly by name; never rely on a
 * legacy alias to keep pointing at the cheap model as DeepSeek's lineup evolves.
 * Every DeepSeek call site imports this constant instead of hardcoding a model
 * string, so there is exactly one place cost-sensitive model selection can change.
 */
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
