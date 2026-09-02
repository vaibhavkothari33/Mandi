'use client'

import Script from 'next/script'
import { useState } from 'react'
import { TEST_CARD } from '@/lib/config'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js'

interface Props {
  keyId: string
  orderId: string
  sessionId: string
  amountPaise: number
  merchantName: string
  description: string
}

type Phase = 'loading' | 'ready' | 'open' | 'confirming' | 'dismissed' | 'failed'

/**
 * Opens Razorpay Checkout against the order the gate already created.
 *
 * Checkout succeeding is not the sale completing. The handler only tells us
 * the buyer finished at the provider; the session still waits for the signed
 * `payment.captured` webhook, so this reloads and lets the server page report
 * whatever actually landed rather than asserting success on its own.
 */
export function PayClient({ keyId, orderId, sessionId, amountPaise, merchantName, description }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)

  const open = () => {
    if (!window.Razorpay) return

    const checkout = new window.Razorpay({
      key: keyId,
      order_id: orderId,
      amount: amountPaise,
      currency: 'INR',
      name: merchantName,
      description,
      notes: { session_id: sessionId },
      theme: { color: '#e2543a' },
      handler: () => {
        // The webhook, not this callback, is what completes the session.
        setPhase('confirming')
        setTimeout(() => window.location.reload(), 2500)
      },
      modal: {
        ondismiss: () => setPhase('dismissed'),
      },
    })

    setPhase('open')
    checkout.open()
  }

  return (
    <>
      {/* onReady fires on a cached script too, so a back-navigation still arms the button. */}
      <Script
        src={CHECKOUT_JS}
        strategy="afterInteractive"
        onReady={() => setPhase((current) => (current === 'loading' ? 'ready' : current))}
        onError={() => {
          setPhase('failed')
          setError('Could not load Razorpay Checkout. Check the network and reload.')
        }}
      />

      {phase === 'confirming' ? (
        <div className="mt-8 rounded-lg border border-neutral-200 dark:border-neutral-800 px-5 py-4 text-sm">
          Payment submitted. Waiting for Razorpay to confirm the capture — this page will refresh itself.
        </div>
      ) : (
        <div className="mt-8">
          <button
            type="button"
            onClick={open}
            disabled={phase === 'loading' || phase === 'failed'}
            className="w-full rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-5 py-3 text-sm font-medium disabled:opacity-40"
          >
            {phase === 'loading'
              ? 'Loading Razorpay…'
              : `Pay ${(amountPaise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}`}
          </button>

          {phase === 'dismissed' && (
            <p className="mt-3 text-sm text-neutral-500">
              Checkout closed. Nothing was charged — press the button to try again.
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <p className="mt-4 text-xs text-neutral-500">
            Razorpay test mode. Use card {TEST_CARD}, any future expiry, any CVV. No real money moves.
          </p>
        </div>
      )}
    </>
  )
}
