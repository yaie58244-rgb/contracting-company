// Marketers sign in with a name and a password only. Supabase Auth needs an
// email, so each marketer gets a hidden, deterministic login address derived
// from the normalized name. The same function runs in the browser (login page)
// and on the server (account creation), so no name→email lookup is exposed.

export const MARKETER_EMAIL_DOMAIN = "marketers.aqar.local";

export function normalizeMarketerName(name: string) {
  return name
    .normalize("NFC")
    .replace(/[ً-ْـ]/g, "") // harakat and tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

export async function marketerEmail(name: string) {
  const bytes = new TextEncoder().encode(normalizeMarketerName(name));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  return `m-${hex.slice(0, 32)}@${MARKETER_EMAIL_DOMAIN}`;
}

export const isMarketerEmail = (email: string) => email.toLowerCase().endsWith(`@${MARKETER_EMAIL_DOMAIN}`);
