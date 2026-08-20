export function generateConnectToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildTelegramDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}

export function parseStartCommand(text: string): string | null {
  const match = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text.trim());
  return match ? match[1] : null;
}
