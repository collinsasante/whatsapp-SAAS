export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  iat: number;
  exp: number;
}

function base64Decode(str: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const padded = base64 + padding;
  let output = '';
  let i = 0;
  while (i < padded.length) {
    const enc1 = chars.indexOf(padded[i++] ?? '');
    const enc2 = chars.indexOf(padded[i++] ?? '');
    const enc3 = chars.indexOf(padded[i++] ?? '');
    const enc4 = chars.indexOf(padded[i++] ?? '');
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    output += String.fromCharCode(chr1);
    if (enc3 !== 64) output += String.fromCharCode(chr2);
    if (enc4 !== 64) output += String.fromCharCode(chr3);
  }
  return output;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const decoded = base64Decode(payload);
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string, bufferSeconds = 30): boolean {
  const payload = decodeJwt(token);
  if (!payload) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp < nowSeconds + bufferSeconds;
}

export function getTokenExpiry(token: string): Date | null {
  const payload = decodeJwt(token);
  if (!payload) return null;
  return new Date(payload.exp * 1000);
}
