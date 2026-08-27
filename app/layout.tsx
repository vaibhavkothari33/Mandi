import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mandi",
  description: "Agentic commerce surface for a Razorpay merchant",
};

const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/orders", label: "Orders" },
  { href: "/merchant", label: "Merchant" },
  { href: "/attacks", label: "Attacks" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
        suppressHydrationWarning
      >
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <nav className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-8">
            <Link href="/" className="font-medium tracking-tight">
              Mandi
            </Link>
            <div className="flex gap-6 text-sm text-neutral-600 dark:text-neutral-400">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="border-t border-neutral-200 dark:border-neutral-800">
          <div className="max-w-5xl mx-auto px-6 py-6 text-xs text-neutral-500 flex flex-wrap gap-x-6 gap-y-2">
            <span>Razorpay test mode. No real money moves.</span>
            <a className="hover:underline" href="/.well-known/agent-commerce">
              Discovery manifest
            </a>
            <a className="hover:underline" href="/api/catalog">
              Agent catalogue
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
