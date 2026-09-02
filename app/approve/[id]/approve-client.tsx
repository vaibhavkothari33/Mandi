'use client'

import Script from 'next/script'
import { useState } from 'react'
import { TEST_CARD } from '@/lib/config'
import { formatInr } from '@/lib/money'

const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js'

interface Props {
  approvalId: string
  amountPaise: number
  merchantName: string
  description: string
  sessionId: string
}

type Phase = 'loading' | 'ready' | 'working' | 'confirm' | 'confirming' | 'done' | 'failed'

interface Reply {
  outcome?: 'price_changed' | 'authorized' | 'captured'
  amountPaise?: number
  previousPaise?: number
  orderId?: string | null
  sessionId?: string
  key_id?: string | null
  error?: { code?: string; message?: string }
}

/**
 * One press: sign the mandates, place the order, open Checkout.
 *
 * The button is the consent. Nothing is signed before it is pressed, and if
 * the price moved while the email sat unread the server refuses to sign the
 * old figure — it returns the new one and this asks again, so what the human
 * agrees to is always what they are shown.
 */
export function ApproveClient({ approvalId, amountPaise, merchantName, description, sessionId }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [amount, setAmount] = useState(amountPaise)
  const [previous, setPrevious] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openCheckout = (orderId: string, keyId: string, payable: number) => {
    const Checkout = window.Razorpay
    if (!Checkout) return

    const checkout = new Checkout({
      key: keyId,
      order_id: orderId,
      amount: payable,
      currency: 'INR',
      name: merchantName,
      description,
      notes: { session_id: sessionId, approval_id: approvalId },
      theme: { color: '#e2543a' },
      handler: () => {
        setPhase('confirming')
        setTimeout(() => window.location.reload(), 2500)
      },
      modal: { ondismiss: () => setPhase('ready') },
    })
    checkout.open()
  }

  const press = async () => {
    setPhase('working')
    setError(null)

    const response = await fetch(`/api/approvals/${approvalId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sent only on the second press, and only for a price already shown.
      body: JSON.stringify(phase === 'confirm' ? { confirmed_amount_paise: amount } : {}),
    }).catch(() => null)

    if (!response) {
      setPhase('failed')
      setError('Could not reach the merchant. Check the connection and try again.')
      return
    }

    const reply = (await response.json().catch(() => ({}))) as Reply

    if (!response.ok) {
      setPhase('failed')
      setError(reply.error?.message ?? 'This approval could not be completed.')
      return
    }

    if (reply.outcome === 'price_changed') {
      setPrevious(reply.previousPaise ?? null)
      setAmount(reply.amountPaise ?? amount)
      setPhase('confirm')
      return
    }

    if (reply.outcome === 'captured') {
      setPhase('done')
      setTimeout(() => window.location.reload(), 1200)
      return
    }

    if (reply.outcome === 'authorized' && reply.orderId && reply.key_id && window.Razorpay) {
      setPhase('ready')
      openCheckout(reply.orderId, reply.key_id, reply.amountPaise ?? amount)
      return
    }

    setPhase('failed')
    setError('The order was placed but Razorpay Checkout could not be opened. Ask for a fresh link.')
  }

  if (phase === 'confirming' || phase === 'done') {
    return (
      <div className="mt-8 rounded-lg border border-neutral-200 dark:border-neutral-800 px-5 py-4 text-sm">
        {phase === 'done'
          ? 'Already paid. Refreshing…'
          : 'Payment submitted. Waiting for Razorpay to confirm the capture — this page will refresh itself.'}
      </div>
    )
  }

  return (
    <>
      <Script
        src={CHECKOUT_JS}
        strategy="afterInteractive"
        onReady={() => setPhase((current) => (current === 'loading' ? 'ready' : current))}
        onError={() => {
          setPhase('failed')
          setError('Could not load Razorpay Checkout. Check the network and reload.')
        }}
      />

      <div className="mt-8">
        {phase === 'confirm' && (
          <div className="mb-4 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm">
            <p className="font-medium">The price moved while this link was waiting.</p>
            <p className="mt-1 text-neutral-600 dark:text-neutral-400">
              {previous !== null && <>Was {formatInr(previous)}. </>}
              Now {formatInr(amount)}. Nothing has been signed — press again to approve the new total.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={press}
          disabled={phase === 'loading' || phase === 'working' || phase === 'failed'}
          className="w-full rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-5 py-3 text-sm font-medium disabled:opacity-40"
        >
          {phase === 'loading' && 'Loading Razorpay…'}
          {phase === 'working' && 'Signing your approval…'}
          {phase === 'confirm' && `Approve & pay ${formatInr(amount)}`}
          {(phase === 'ready' || phase === 'failed') && `Approve & pay ${formatInr(amount)}`}
        </button>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <p className="mt-4 text-xs text-neutral-500">
          Pressing this signs the intent and cart mandates in your name, then opens Razorpay test mode. Card{' '}
          {TEST_CARD}, any future expiry, any CVV. No real money moves.
        </p>
      </div>
    </>
  )
}
