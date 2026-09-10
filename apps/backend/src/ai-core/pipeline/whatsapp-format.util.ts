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
