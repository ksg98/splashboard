/**
 * Masks an API key for display, keeping its prefix and last four characters:
 * "sk-splash-2b9c41e07d5a7f3a" → "sk-splash-••••••••••••7f3a".
 */
export function maskKey(key: string): string {
  const cut = key.lastIndexOf('-') + 1;
  const prefix = cut > 0 && cut < key.length - 4 ? key.slice(0, cut) : '';
  const tail = key.length > 8 ? key.slice(-4) : '';
  return `${prefix}${'•'.repeat(12)}${tail}`;
}
