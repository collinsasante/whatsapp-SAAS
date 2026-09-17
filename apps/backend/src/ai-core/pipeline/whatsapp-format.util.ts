/**
 * The system prompt tells the model "do not use markdown formatting", but
 * DeepSeek doesn't reliably follow that instruction -- it still emits
 * standard Markdown (**bold**, # headers, [text](url) links) that WhatsApp
 * doesn't understand, so customers see literal asterisks/hashes instead of
 * formatted text. Rather than depend on prompt compliance, this deterministic
 * pass converts the common cases to WhatsApp's own formatting syntax
 * (*bold*, _italic_, ~strikethrough~, ```monospace```) or strips what has no
 * WhatsApp equivalent (headers, links).
 */
export function sanitizeForWhatsApp(text: string): string {
  return text
    // **bold** / __bold__ -> *bold* (WhatsApp's bold delimiter)
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    // Markdown links [text](url) -> "text: url" (WhatsApp has no link syntax)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
    // Headers "## Title" -> a bold line (WhatsApp has no heading syntax)
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    // Collapse any remaining run of 2+ asterisks left over from malformed/nested
    // markdown into WhatsApp's single-asterisk bold delimiter.
    .replace(/\*{2,}/g, '*');
}

/**
 * Messenger's Send API text messages are genuinely plain text -- there is no
 * bold/italic/strikethrough delimiter syntax at all (unlike WhatsApp's own
 * bold and italic delimiters). Rather than convert markdown to a delimiter
 * Messenger would just render literally, this strips it entirely so the
 * customer sees clean prose instead of stray asterisks/hashes.
 */
export function sanitizeForMessenger(text: string): string {
  return text
    // **bold** / __bold__ -> bold (drop the delimiters)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Any remaining single-asterisk emphasis (WhatsApp-style *bold*, or
    // leftover malformed runs) -> plain
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\*{2,}/g, '')
    // WhatsApp-style _italic_ (single underscore) -> plain. Without this,
    // a model that emits standard markdown italics leaks literal
    // underscores into a Messenger customer's message.
    .replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g, '$1')
    // Markdown links [text](url) -> "text: url" (same fallback as WhatsApp --
    // Messenger's plain-text messages have no link syntax either)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
    // Headers "## Title" -> a plain line
    .replace(/^#{1,6}\s+(.+)$/gm, '$1');
}
