import axios from 'axios';

interface ErrorPayload {
  method?: string;
  url?: string;
  status?: number;
  tenantId?: string;
  message: string;
  stack?: string;
  source: 'backend' | 'frontend';
  extra?: Record<string, unknown>;
}

// Simple in-memory cooldown — prevents flooding channels when a burst of identical
// errors hits (e.g. a broken endpoint called 100x). Keyed on error fingerprint.
const COOLDOWN_MS = 60_000;
const cooldowns = new Map<string, number>();

function fingerprint(p: ErrorPayload): string {
  return `${p.source}:${p.status ?? 0}:${p.url ?? ''}:${p.message.slice(0, 80)}`;
}

function throttled(p: ErrorPayload): boolean {
  const key = fingerprint(p);
  const last = cooldowns.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return true;
  cooldowns.set(key, Date.now());
  return false;
}

function buildText(p: ErrorPayload): string {
  const icon = p.source === 'frontend' ? '🖥' : '🔥';
  const lines = [
    `${icon} *${p.source === 'frontend' ? 'Frontend' : 'Backend'} Error* — verzchat.com`,
    p.method && p.url ? `\`${p.method.toUpperCase()} ${p.url}\`` : '',
    p.status ? `Status: ${p.status}` : '',
    p.tenantId ? `Tenant: \`${p.tenantId}\`` : '',
    `Error: ${p.message}`,
    p.stack ? `\`\`\`\n${p.stack.slice(0, 600)}\n\`\`\`` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text, parse_mode: 'Markdown' },
    { timeout: 5000 },
  ).catch(() => { /* never throw — notifier must not break request handling */ });
}

async function sendSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await axios.post(url, { text }, { timeout: 5000 })
    .catch(() => { /* same */ });
}

export async function notify(payload: ErrorPayload): Promise<void> {
  if (throttled(payload)) return;
  const text = buildText(payload);
  await Promise.all([sendTelegram(text), sendSlack(text)]);
}
