import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

// Cairo was named in the styles but never loaded, so Windows fell back to a plain system font.
const cairo = Cairo({ subsets: ["arabic", "latin"], display: "swap", variable: "--font-arabic" });
export const metadata: Metadata = { title:"البتول | إدارة العقارات والعملاء", description:"منصة ذكية لإدارة العقارات والعملاء في الكويت" };

// Warm up the Supabase connection while the bundle loads so the first data
// request does not pay for DNS and TLS handshakes.
function originOf(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const origins = [...new Set([originOf(process.env.NEXT_PUBLIC_SUPABASE_URL)])]
    .filter((value): value is string => Boolean(value));

  return <html lang="ar" dir="rtl" className={cairo.variable} suppressHydrationWarning><head>{origins.map(origin => <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />)}</head><body>{children}</body></html>;
}
