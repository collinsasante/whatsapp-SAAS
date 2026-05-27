import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMessageTime(date: Date | string): string {
  const d = new Date(date);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd/MM/yyyy');
}

export function formatRelativeTime(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

export function formatPhoneForDisplay(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  return phone;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}...`;
}

/**
 * Rewrites direct S3 URLs to go through the backend proxy endpoint.
 * Needed because the S3 bucket has "Block all public access" enabled.
 * Proxy endpoint: /api/v1/media/serve/:fileKey  (slashes in key encoded as ~)
 */
export function getProxiedMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Already going through our proxy — return as-is to avoid double prefix
  if (url.includes('/api/v1/media/serve/')) return url;
  // Expired Meta/Facebook temp download URLs — inaccessible from browser, return empty
  if (url.includes('fbsbx.com') || url.includes('lookaside.facebook.com')) return '';
  // Direct S3 URL: https://<bucket>.s3[.<region>].amazonaws.com/<key>
  const s3Match = url.match(/https?:\/\/[^/]+\.amazonaws\.com\/(.+)/);
  if (s3Match) {
    // Use window.location.origin (not NEXT_PUBLIC_API_URL which may include /api/v1)
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fileKey = s3Match[1].replace(/\//g, '~');
    return `${origin}/api/v1/media/serve/${fileKey}`;
  }
  return url;
}

/** WhatsApp Cloud API only accepts mp4 and 3gpp video — nothing else */
export const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/3gpp', 'video/3gp'];
export const SUPPORTED_AUDIO_TYPES = ['audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/amr'];

export function isVideoSupported(file: File): boolean {
  return SUPPORTED_VIDEO_TYPES.includes(file.type) ||
    file.name.toLowerCase().endsWith('.mp4') ||
    file.name.toLowerCase().endsWith('.3gp');
}

export function isAudioSupported(file: File): boolean {
  return SUPPORTED_AUDIO_TYPES.some((t) => file.type.startsWith(t)) ||
    /\.(ogg|mp3|aac|amr|m4a)$/i.test(file.name);
}

// Extracts a human-readable message from an Axios/fetch error.
// Falls back to `fallback` when no backend message is available.
export function getApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err && typeof err === 'object') {
    const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } };
    const status = axiosErr.response?.status;
    const raw = axiosErr.response?.data?.message;
    const msg = Array.isArray(raw) ? raw[0] : raw;

    if (status === 401) return 'Your session has expired. Please log in again.';
    if (status === 403) return msg ?? 'You don\'t have permission to do that.';
    if (status === 429) return 'Too many requests. Please wait a moment and try again.';
    if (status === 413) return 'File is too large.';
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
