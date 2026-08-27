import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/**
 * Drives the MCP server the way a real client does: one request at a time,
 * awaiting each result. Shows that the agent's tools stop at consent.
 */
const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'mcp/server.ts'], {
  stdio: ['pipe', 'pipe', 'inherit'],
})

const lines = createInterface({ input: child.stdout })
const waiting = new Map<number, (value: any) => void>()

lines.on('line', (line) => {
  const message = JSON.parse(line)
  const resolve = waiting.get(message.id)
  if (resolve) {
    waiting.delete(message.id)
    resolve(message)
  }
})

let nextId = 1

const send = (method: string, params: unknown): Promise<any> => {
  const id = nextId++
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

const notify = (method: string) =>
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)

async function tool(name: string, args: Record<string, unknown>): Promise<string> {
  const reply = await send('tools/call', { name, arguments: args })
  return reply.result.content[0].text as string
}

const show = (label: string, body: string) =>
  console.log(`\n${label}\n${body.split('\n').map((l) => `   ${l}`).join('\n')}`)

await send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'mandi-demo', version: '1' },
})
notify('notifications/initialized')

show('agent searches the catalogue', (await tool('search_catalog', { category: 'grocery' })).split('\n').slice(0, 3).join('\n'))

const checkout = await tool('start_checkout', {
  items: [{ product_id: 'sku_chai_250', quantity: 2 }],
})
show('agent opens a checkout', checkout)
const sessionId = checkout.match(/session (cs_\w+)/)![1]

show('agent locks the price', await tool('get_quote', { session_id: sessionId }))

const requested = await tool('request_approval', { session_id: sessionId })
show('agent asks the human', requested)
const approvalId = requested.match(/approval (apr_\w+)/)![1]

show(
  'agent tries to spend it anyway, before the human has decided',
  await tool('complete_purchase', { session_id: sessionId, approval_id: approvalId }),
)

const { approve } = await import('../lib/wallet.ts')
approve(approvalId)
console.log('\nthe human approves in their wallet: npm run approve -- ' + approvalId)

show('agent checks again', await tool('check_approval', { approval_id: approvalId }))
show(
  'agent completes the purchase',
  await tool('complete_purchase', { session_id: sessionId, approval_id: approvalId }),
)

child.kill()
