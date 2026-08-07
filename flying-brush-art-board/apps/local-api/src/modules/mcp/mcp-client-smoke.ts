import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const serverUrl = process.env.MCP_SERVER_URL
const accessToken = process.env.MCP_OAUTH_ACCESS_TOKEN
if (!serverUrl) throw new Error('MCP_SERVER_URL is required')
if (!accessToken) throw new Error('MCP_OAUTH_ACCESS_TOKEN is required')

const client = new Client({ name: 'infinite-board-v2-compatibility-probe', version: '2.0.0' })
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  }) as never)
  const tools = await client.listTools()
  const capabilities = await client.callTool({ name: 'system_get_capabilities', arguments: {} })
  const currentUser = await client.callTool({ name: 'system_get_current_user', arguments: {} })
  if (capabilities.isError || currentUser.isError) throw new Error('MCP_DISCOVERY_CALL_FAILED')
  console.log(JSON.stringify({ ok: true, toolCount: tools.tools.length, tools: tools.tools.map((tool) => tool.name).sort() }, null, 2))
} finally {
  await client.close()
}
