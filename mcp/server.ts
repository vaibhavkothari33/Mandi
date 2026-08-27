import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.ts'

const server = registerTools(new McpServer({ name: 'mandi-buyer', version: '0.1.0' }))

await server.connect(new StdioServerTransport())
