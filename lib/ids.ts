import { randomUUID } from 'node:crypto'

const id = (prefix: string) => () => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`

export const sessionId = id('cs')
export const quoteId = id('qt')
export const mandateId = id('mdt')
export const paymentId = id('pay')
export const requestId = id('req')
