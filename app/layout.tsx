import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "./nav";
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
        <Nav />

        <div className="flex-1">{children}</div>

        <footer className="border-t border-neutral-200 dark:border-neutral-800 mt-8">
          <div className="max-w-5xl mx-auto px-6 py-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-neutral-500">
            <span>Razorpay test mode. No real money moves.</span>
            <a className="hover:text-neutral-900 dark:hover:text-neutral-200" href="/.well-known/agent-commerce">
              Discovery manifest
            </a>
            <a className="hover:text-neutral-900 dark:hover:text-neutral-200" href="/api/catalog">
              Agent catalogue
            </a>
            <a className="hover:text-neutral-900 dark:hover:text-neutral-200" href="/.well-known/jwks.json">
              Signing keys
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
