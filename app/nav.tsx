'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CART_CHANGED, cartCount, readCart } from './shop/cart'

const LINKS = [
  { href: '/shop', label: 'Shop' },
  { href: '/orders', label: 'Orders' },
  { href: '/merchant', label: 'Merchant' },
  { href: '/attacks', label: 'Attacks' },
]

/** A market stall: canopy over a counter. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect width="24" height="24" rx="7" className="fill-neutral-900 dark:fill-white" />
      <path d="M5 10.5 L12 5.5 L19 10.5 Z" className="fill-amber-500" />
      <path
        d="M5 10.5 h14 v1.6 a2.1 2.1 0 0 1 -3.5 0 a2.1 2.1 0 0 1 -3.5 0 a2.1 2.1 0 0 1 -3.5 0 a2.1 2.1 0 0 1 -3.5 0 z"
        className="fill-amber-400"
      />
      <rect
        x="7.5"
        y="13.5"
        width="9"
        height="5"
        rx="1"
        className="fill-white dark:fill-neutral-900"
      />
    </svg>
  )
}

function CartBadge({ onNavigate }: { onNavigate?: () => void }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const sync = () => setCount(cartCount(readCart()))
    sync()

    window.addEventListener(CART_CHANGED, sync)
    // Keeps a second tab honest.
    window.addEventListener('storage', sync)

    return () => {
      window.removeEventListener(CART_CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (count === 0) return null

  return (
    <Link
      href="/shop/checkout"
      onClick={onNavigate}
      className="relative inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 pl-3.5 pr-4 py-1.5 text-sm font-medium hover:opacity-90"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.55L20.5 8H6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="20" r="1.4" fill="currentColor" />
        <circle cx="17" cy="20" r="1.4" fill="currentColor" />
      </svg>
      <span className="tabular-nums">{count}</span>
      <span className="sr-only">items in cart</span>
    </Link>
  )
}

export function Nav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // A tapped link should not leave the panel hanging open behind the new page.
  useEffect(() => setOpen(false), [pathname])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur supports-[backdrop-filter]:bg-white/65 dark:supports-[backdrop-filter]:bg-neutral-950/65">
      {/* Links are centred against the bar itself, so the logo and cart can change
          width without dragging them off centre. */}
      <nav className="relative max-w-7xl mx-auto px-5 sm:px-7 h-16 flex items-center">
        <Link href="/" className="flex items-center gap-2.5 font-medium tracking-tight shrink-0">
          <Mark />
          Mandi
        </Link>

        <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                isActive(link.href)
                  ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-900'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <CartBadge />

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="md:hidden w-9 h-9 grid place-items-center rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="md:hidden border-t border-neutral-200 dark:border-neutral-800 px-5 py-3">
          <div className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? 'page' : undefined}
                className={`px-3 py-2.5 rounded-md text-sm ${
                  isActive(link.href)
                    ? 'bg-neutral-100 dark:bg-neutral-800'
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}
