import { getProduct } from './catalog.ts'
import { MERCHANT, TEST_CARD } from './config.ts'
import { formatInr, type Paise } from './money.ts'
import type { Session } from './session/store.ts'

const DEFAULT_RECIPIENT = 'vaibhavkothari50@gmail.com'
const DEFAULT_NAME = 'Vaibhav Kothari'
const RECEIPT_HEADER_IMAGE = 'https://res.cloudinary.com/dvjtkztjt/image/upload/q_auto/f_auto/v1781852461/8e02e87b-2033-4a42-a511-ce963f463f1e_p9poxd.png'

/** Header image render width in px. Kept small and centred; the source asset is far wider so it stays crisp on retina. */
const HEADER_IMAGE_WIDTH = 200

const C = {
  ink: '#1a1a1a',
  body: '#4a4a4a',
  muted: '#8c8c8c',
  rule: '#e6e6e6',
  hairline: '#f0f0f0',
  accent: '#e2543a',
  bar: '#262626',
} as const

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const SERIF = "Georgia,'Times New Roman',Times,serif"

/** Sends only when configured. Email failure never affects a completed payment. */
export async function sendPurchaseReceipt(input: { session: Session; paymentReference: string | null; amountPaise: Paise }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const recipient = process.env.RECEIPT_TO_EMAIL ?? DEFAULT_RECIPIENT
  const recipientName = process.env.RECEIPT_TO_NAME ?? DEFAULT_NAME
  const from = process.env.RESEND_FROM ?? 'Mandi <onboarding@resend.dev>'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `mandi-receipt-${input.session.id}` },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `Purchase complete — ${MERCHANT.name} ${input.session.id}`,
      html: receiptHtml({ ...input, recipientName }),
      text: receiptText({ ...input, recipientName }),
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend rejected receipt (${response.status}): ${detail.slice(0, 300)}`)
  }
}

type ReceiptInput = { session: Session; paymentReference: string | null; amountPaise: Paise; recipientName: string }

export function receiptHtml(input: ReceiptInput): string {
  const totals = input.session.totals

  const th = (label: string, align: 'left' | 'center' | 'right') =>
    `<th align="${align}" style="padding:0 0 10px;font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;color:${C.muted};text-align:${align};border-bottom:1px solid ${C.rule};">${label}</th>`

  const rows = input.session.items
    .map((item) => {
      const title = escapeHtml(getProduct(item.product_id)?.title ?? item.product_id)
      const cell = `padding:13px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink};border-bottom:1px solid ${C.hairline};vertical-align:top;`
      return `<tr>
                    <td valign="top" style="${cell}padding-right:12px;">${title}</td>
                    <td valign="top" align="center" style="${cell}text-align:center;color:${C.body};white-space:nowrap;">${item.quantity}</td>
                    <td valign="top" align="right" style="${cell}text-align:right;color:${C.body};white-space:nowrap;padding-left:12px;">${formatInr(item.unit_price_paise)}</td>
                    <td valign="top" align="right" style="${cell}text-align:right;white-space:nowrap;padding-left:16px;">${formatInr((item.unit_price_paise * item.quantity) as Paise)}</td>
                  </tr>`
    })
    .join('')

  const totalRow = (label: string, value: string) =>
    `<tr>
                        <td style="padding:4px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.body};">${label}</td>
                        <td align="right" style="padding:4px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink};text-align:right;white-space:nowrap;">${value}</td>
                      </tr>`

  const metaRow = (label: string, value: string) =>
    `<tr>
                        <td style="padding:3px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted};">${label}</td>
                        <td align="right" style="padding:3px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.body};text-align:right;word-break:break-all;">${value}</td>
                      </tr>`

  const preheader = `Receipt for order ${escapeHtml(input.session.id)} — ${formatInr(input.amountPaise)} paid.`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(MERCHANT.name)} receipt</title>
<!--[if mso]><style>table,td,div,p,a,th{font-family:Arial,Helvetica,sans-serif !important;} h1{font-family:Georgia,serif !important;}</style><![endif]-->
<style>
  body,table,td,p,a,h1,th{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse !important;}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  @media only screen and (max-width:600px){
    .sp{padding-left:24px !important;padding-right:24px !important;}
    .h1{font-size:24px !important;line-height:32px !important;}
    .bar{font-size:14px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:560px;border-left:1px solid ${C.hairline};border-right:1px solid ${C.hairline};">

        <tr><td style="height:40px;line-height:40px;font-size:0;">&nbsp;</td></tr>

        <!-- Header image: small, centred -->
        <tr>
          <td align="center" class="sp" style="padding:0 40px;">
            <img src="${RECEIPT_HEADER_IMAGE}" alt="${escapeHtml(MERCHANT.name)}" width="${HEADER_IMAGE_WIDTH}" style="display:block;width:${HEADER_IMAGE_WIDTH}px;max-width:100%;height:auto;margin:0 auto;">
          </td>
        </tr>

        <!-- Eyebrow + title -->
        <tr>
          <td align="center" class="sp" style="padding:34px 40px 0;">
            <div style="font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${C.accent};">Payment successful</div>
            <h1 class="h1" style="margin:12px 0 0;font-family:${SERIF};font-size:27px;line-height:36px;font-weight:400;color:${C.ink};">Your ${escapeHtml(MERCHANT.name)} receipt</h1>
          </td>
        </tr>

        <!-- Body copy -->
        <tr>
          <td class="sp" style="padding:28px 40px 0;font-family:${SANS};font-size:13px;line-height:21px;color:${C.body};">
            <p style="margin:0 0 14px;">Hi ${escapeHtml(input.recipientName)},</p>
            <p style="margin:0 0 14px;">Thank you for your order — your payment has gone through and we&rsquo;re getting it ready. Here&rsquo;s a summary of what you bought.</p>
          </td>
        </tr>

        <!-- Items table -->
        <tr>
          <td class="sp" style="padding:22px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
              <thead>
                <tr>
                  ${th('Item', 'left')}
                  ${th('Qty', 'center')}
                  ${th('Price', 'right')}
                  ${th('Amount', 'right')}
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </td>
        </tr>

        <!-- Totals -->
        <tr>
          <td class="sp" style="padding:16px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" style="width:240px;max-width:100%;">
              ${totalRow('Items', formatInr(totals.items_paise))}
              ${totalRow('Shipping', formatInr(totals.shipping_paise))}
              ${totalRow('Tax', formatInr(totals.tax_paise))}
              <tr>
                <td style="padding:11px 0 0;border-top:1px solid ${C.rule};font-family:${SANS};font-size:14px;line-height:20px;font-weight:700;color:${C.ink};">Total</td>
                <td align="right" style="padding:11px 0 0;border-top:1px solid ${C.rule};font-family:${SANS};font-size:14px;line-height:20px;font-weight:700;color:${C.ink};text-align:right;white-space:nowrap;">${formatInr(totals.total_paise)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>

        <!-- Amount-paid bar -->
        <tr>
          <td class="sp" style="padding:0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" bgcolor="${C.bar}" style="background-color:${C.bar};border-radius:3px;padding:15px 20px;">
                  <span class="bar" style="font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;color:#ffffff;">Total paid &nbsp;·&nbsp; ${formatInr(input.amountPaise)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Order meta -->
        <tr>
          <td class="sp" style="padding:26px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              ${metaRow('Order ID', escapeHtml(input.session.id))}
              ${input.paymentReference ? metaRow('Payment reference', escapeHtml(input.paymentReference)) : ''}
            </table>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td align="center" class="sp" style="padding:34px 40px 0;font-family:${SANS};font-size:13px;line-height:21px;color:${C.body};">
            Warm regards,<br><strong style="color:${C.ink};">The ${escapeHtml(MERCHANT.name)} team</strong>
          </td>
        </tr>

        <tr>
          <td align="center" class="sp" style="padding:26px 40px 40px;">
            <div style="border-top:1px solid ${C.hairline};padding-top:18px;font-family:${SANS};font-size:11px;line-height:17px;color:${C.muted};">Please keep this email for your records.</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

export function receiptText(input: ReceiptInput): string {
  const t = input.session.totals
  const lines = input.session.items.map(
    (item) => `  ${item.quantity} x ${getProduct(item.product_id)?.title ?? item.product_id} — ${formatInr((item.unit_price_paise * item.quantity) as Paise)}`,
  )
  const rule = '-'.repeat(44)
  return [
    `${MERCHANT.name} — Payment successful`,
    '='.repeat(44),
    '',
    `Hi ${input.recipientName},`,
    '',
    "Thank you for your order — your payment has gone through and we're getting it ready.",
    '',
    'Order summary',
    rule,
    ...lines,
    rule,
    `Items:    ${formatInr(t.items_paise)}`,
    `Shipping: ${formatInr(t.shipping_paise)}`,
    `Tax:      ${formatInr(t.tax_paise)}`,
    `Total:    ${formatInr(t.total_paise)}`,
    '',
    `TOTAL PAID: ${formatInr(input.amountPaise)}`,
    '',
    `Order ID: ${input.session.id}`,
    `Payment reference: ${input.paymentReference ?? 'recorded'}`,
    '',
    'Warm regards,',
    `The ${MERCHANT.name} team`,
    '',
    'Please keep this email for your records.',
  ].join('\n')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!)
}
interface PaymentDueInput {
  session: Session
  amountPaise: Paise
  payUrl: string
}

/**
 * Emails the buyer a link to pay a session that is approved but uncaptured.
 *
 * Sent when the gate authorises a purchase the provider has not settled. It
 * carries the merchant's own pay page rather than a Razorpay payment link, so
 * it is not subject to the thirty-link test-mode cap. Like the receipt, it
 * sends only when configured and never affects the payment either way.
 */
export async function sendPaymentDue(input: PaymentDueInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const recipient = process.env.RECEIPT_TO_EMAIL ?? DEFAULT_RECIPIENT
  const recipientName = process.env.RECEIPT_TO_NAME ?? DEFAULT_NAME
  const from = process.env.RESEND_FROM ?? 'Mandi <onboarding@resend.dev>'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // One payment request per session, however many times the mail is attempted.
      'Idempotency-Key': `mandi-payment-due-${input.session.id}`,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `Payment requested — ${MERCHANT.name} ${formatInr(input.amountPaise)}`,
      html: paymentDueHtml({ ...input, recipientName }),
      text: paymentDueText({ ...input, recipientName }),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend rejected payment request (${response.status}): ${detail.slice(0, 300)}`)
  }
}

type PaymentDueBody = PaymentDueInput & { recipientName: string }

export function paymentDueHtml(input: PaymentDueBody): string {
  const lines = input.session.items
    .map((item) => {
      const title = escapeHtml(getProduct(item.product_id)?.title ?? item.product_id)
      const cell = `padding:11px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink};border-bottom:1px solid ${C.hairline};`
      return `<tr>
                    <td style="${cell}">${title} <span style="color:${C.muted};">&times; ${item.quantity}</span></td>
                    <td align="right" style="${cell}text-align:right;white-space:nowrap;">${formatInr((item.unit_price_paise * item.quantity) as Paise)}</td>
                  </tr>`
    })
    .join('')

  const preheader = `${formatInr(input.amountPaise)} is waiting to be paid for order ${escapeHtml(input.session.id)}.`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${escapeHtml(MERCHANT.name)} payment request</title>
<style>
  body,table,td,p,a,h1{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse !important;}
  img{border:0;outline:none;text-decoration:none;}
  @media only screen and (max-width:600px){ .sp{padding-left:24px !important;padding-right:24px !important;} .h1{font-size:24px !important;line-height:32px !important;} }
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:560px;border-left:1px solid ${C.hairline};border-right:1px solid ${C.hairline};">

        <tr><td style="height:40px;line-height:40px;font-size:0;">&nbsp;</td></tr>

        <tr>
          <td align="center" class="sp" style="padding:0 40px;">
            <img src="${RECEIPT_HEADER_IMAGE}" alt="${escapeHtml(MERCHANT.name)}" width="${HEADER_IMAGE_WIDTH}" style="display:block;width:${HEADER_IMAGE_WIDTH}px;max-width:100%;height:auto;margin:0 auto;">
          </td>
        </tr>

        <tr>
          <td align="center" class="sp" style="padding:34px 40px 0;">
            <div style="font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${C.accent};">Payment requested</div>
            <h1 class="h1" style="margin:12px 0 0;font-family:${SERIF};font-size:27px;line-height:36px;font-weight:400;color:${C.ink};">Your order is waiting to be paid</h1>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:28px 40px 0;font-family:${SANS};font-size:13px;line-height:21px;color:${C.body};">
            <p style="margin:0 0 14px;">Hi ${escapeHtml(input.recipientName)},</p>
            <p style="margin:0 0 14px;">You approved this purchase, and we&rsquo;ve placed the order with the provider. Nothing has been charged yet &mdash; open the link below to pay it.</p>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:22px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${lines}</table>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:24px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" bgcolor="${C.bar}" style="background-color:${C.bar};border-radius:3px;padding:15px 20px;">
                  <a href="${escapeHtml(input.payUrl)}" style="font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;color:#ffffff;text-decoration:none;">Pay ${formatInr(input.amountPaise)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-family:${SANS};font-size:11px;line-height:17px;color:${C.muted};word-break:break-all;">${escapeHtml(input.payUrl)}</p>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:26px 40px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted};">
            Razorpay test mode &mdash; card ${TEST_CARD}, any future expiry, any CVV. No real money moves.
          </td>
        </tr>

        <tr>
          <td align="center" class="sp" style="padding:26px 40px 40px;">
            <div style="border-top:1px solid ${C.hairline};padding-top:18px;font-family:${SANS};font-size:11px;line-height:17px;color:${C.muted};">Order ${escapeHtml(input.session.id)}</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

export function paymentDueText(input: PaymentDueBody): string {
  return [
    `${MERCHANT.name} — Payment requested`,
    '='.repeat(44),
    '',
    `Hi ${input.recipientName},`,
    '',
    "You approved this purchase and we've placed the order with the provider.",
    'Nothing has been charged yet. Pay it here:',
    '',
    input.payUrl,
    '',
    ...input.session.items.map(
      (item) => `  ${item.quantity} x ${getProduct(item.product_id)?.title ?? item.product_id} — ${formatInr((item.unit_price_paise * item.quantity) as Paise)}`,
    ),
    '',
    `AMOUNT DUE: ${formatInr(input.amountPaise)}`,
    '',
    `Razorpay test mode — card ${TEST_CARD}, any future expiry, any CVV.`,
    '',
    `Order ${input.session.id}`,
  ].join('\n')
}

interface ApprovalRequestInput {
  session: Session
  amountPaise: Paise
  approveUrl: string
  agentId: string
}

/**
 * Emails the human the consent link for a purchase an agent wants to make.
 *
 * This is the first mail in the agent flow and the one that carries authority:
 * the link it holds is what signs the mandates. It goes out when the agent asks
 * for approval, not when it spends — the agent has no way to reach this.
 */
export async function sendApprovalRequest(input: ApprovalRequestInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const recipient = process.env.RECEIPT_TO_EMAIL ?? DEFAULT_RECIPIENT
  const recipientName = process.env.RECEIPT_TO_NAME ?? DEFAULT_NAME
  const from = process.env.RESEND_FROM ?? 'Mandi <onboarding@resend.dev>'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Keyed on the approval itself, so a retried request never sends twice
      // but a genuinely new one always does.
      'Idempotency-Key': `mandi-approval-${input.approveUrl.split('/').pop()}`,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `Approve ${formatInr(input.amountPaise)} — ${MERCHANT.name}`,
      html: approvalRequestHtml({ ...input, recipientName }),
      text: approvalRequestText({ ...input, recipientName }),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend rejected approval request (${response.status}): ${detail.slice(0, 300)}`)
  }
}

type ApprovalRequestBody = ApprovalRequestInput & { recipientName: string }

export function approvalRequestHtml(input: ApprovalRequestBody): string {
  const lines = input.session.items
    .map((item) => {
      const title = escapeHtml(getProduct(item.product_id)?.title ?? item.product_id)
      const cell = `padding:11px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${C.ink};border-bottom:1px solid ${C.hairline};`
      return `<tr>
                    <td style="${cell}">${title} <span style="color:${C.muted};">&times; ${item.quantity}</span></td>
                    <td align="right" style="${cell}text-align:right;white-space:nowrap;">${formatInr((item.unit_price_paise * item.quantity) as Paise)}</td>
                  </tr>`
    })
    .join('')

  const preheader = `${escapeHtml(input.agentId)} wants to spend ${formatInr(input.amountPaise)} on your behalf.`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${escapeHtml(MERCHANT.name)} approval request</title>
<style>
  body,table,td,p,a,h1{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse !important;}
  img{border:0;outline:none;text-decoration:none;}
  @media only screen and (max-width:600px){ .sp{padding-left:24px !important;padding-right:24px !important;} .h1{font-size:24px !important;line-height:32px !important;} }
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:560px;border-left:1px solid ${C.hairline};border-right:1px solid ${C.hairline};">

        <tr><td style="height:40px;line-height:40px;font-size:0;">&nbsp;</td></tr>

        <tr>
          <td align="center" class="sp" style="padding:0 40px;">
            <img src="${RECEIPT_HEADER_IMAGE}" alt="${escapeHtml(MERCHANT.name)}" width="${HEADER_IMAGE_WIDTH}" style="display:block;width:${HEADER_IMAGE_WIDTH}px;max-width:100%;height:auto;margin:0 auto;">
          </td>
        </tr>

        <tr>
          <td align="center" class="sp" style="padding:34px 40px 0;">
            <div style="font-family:${SANS};font-size:10px;line-height:14px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${C.accent};">Approval needed</div>
            <h1 class="h1" style="margin:12px 0 0;font-family:${SERIF};font-size:27px;line-height:36px;font-weight:400;color:${C.ink};">An agent wants to buy this for you</h1>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:28px 40px 0;font-family:${SANS};font-size:13px;line-height:21px;color:${C.body};">
            <p style="margin:0 0 14px;">Hi ${escapeHtml(input.recipientName)},</p>
            <p style="margin:0 0 14px;"><strong style="color:${C.ink};">${escapeHtml(input.agentId)}</strong> has asked to spend ${formatInr(input.amountPaise)} on your behalf. It cannot approve this itself and it cannot spend more than this total. Nothing is signed until you press the button.</p>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:22px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${lines}</table>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:24px 40px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" bgcolor="${C.bar}" style="background-color:${C.bar};border-radius:3px;padding:15px 20px;">
                  <a href="${escapeHtml(input.approveUrl)}" style="font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;color:#ffffff;text-decoration:none;">Approve &amp; pay ${formatInr(input.amountPaise)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-family:${SANS};font-size:11px;line-height:17px;color:${C.muted};word-break:break-all;">${escapeHtml(input.approveUrl)}</p>
          </td>
        </tr>

        <tr>
          <td class="sp" style="padding:26px 40px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted};">
            If the price moves before you open this, you will be shown the new total and asked again. Razorpay test mode &mdash; card ${TEST_CARD}, any future expiry, any CVV. No real money moves.
          </td>
        </tr>

        <tr>
          <td align="center" class="sp" style="padding:26px 40px 40px;">
            <div style="border-top:1px solid ${C.hairline};padding-top:18px;font-family:${SANS};font-size:11px;line-height:17px;color:${C.muted};">Order ${escapeHtml(input.session.id)}</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

export function approvalRequestText(input: ApprovalRequestBody): string {
  return [
    `${MERCHANT.name} — Approval needed`,
    '='.repeat(44),
    '',
    `Hi ${input.recipientName},`,
    '',
    `${input.agentId} has asked to spend ${formatInr(input.amountPaise)} on your behalf.`,
    'It cannot approve this itself. Nothing is signed until you open this link:',
    '',
    input.approveUrl,
    '',
    ...input.session.items.map(
      (item) => `  ${item.quantity} x ${getProduct(item.product_id)?.title ?? item.product_id} — ${formatInr((item.unit_price_paise * item.quantity) as Paise)}`,
    ),
    '',
    `TOTAL: ${formatInr(input.amountPaise)}`,
    '',
    'If the price moves before you open it, you will be shown the new total and asked again.',
    `Razorpay test mode — card ${TEST_CARD}, any future expiry, any CVV.`,
    '',
    `Order ${input.session.id}`,
  ].join('\n')
}
