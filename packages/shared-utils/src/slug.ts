export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

export function generateUniqueSlug(name: string, suffix?: string): string {
  const base = generateSlug(name);
  return suffix ? `${base}-${suffix}` : base;
}
