import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.ts'

/**
 * Next loads `.env` for the HTTP surface, but this process is plain node and
 * gets nothing. Without it `PUBLIC_BASE_URL` is unset and every consent link
 * the tools email out points at localhost, which is useless to the human
 * holding the phone.
 */
try {
  process.loadEnvFile()
} catch {
  // No .env is a valid way to run the stub executor; defaults apply.
}

const server = registerTools(new McpServer({ name: 'mandi-buyer', version: '0.1.0' }))

await server.connect(new StdioServerTransport())
