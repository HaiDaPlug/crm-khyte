import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { crmDatabase } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { authenticateBearer, readBearerToken } from '@/lib/mcp/oauth'
import { createCrmMcpServer } from '@/lib/mcp/server'
import { checkOrigin, noStore, readBody } from '@/lib/mcp/http'
import { config } from '@/lib/mcp/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A bulk import commits each row separately, so the request is far longer-lived
// than a single tool call. Vercel's per-plan ceiling still applies above this.
export const maxDuration = 300

export async function POST(request: Request) {
  let server: ReturnType<typeof createCrmMcpServer> | undefined
  try {
    config(); checkOrigin(request)
    readBearerToken(request.headers.get('authorization'))
    const db = crmDatabase()
    const principal = await authenticateBearer(db, request.headers.get('authorization'))
    const body = await readBody(request)
    let parsed: unknown
    try { parsed = JSON.parse(body) } catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: noStore }) }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    server = createCrmMcpServer(db, principal)
    await server.connect(transport)
    const response = await transport.handleRequest(request, { parsedBody: parsed })
    // JSON mode completes tool execution before resolving; no live SSE stream is cut short.
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    if (error instanceof CrmError && error.code === 'unauthorized') {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: { ...noStore,
        'WWW-Authenticate': `Bearer resource_metadata="${config().origin}/.well-known/oauth-protected-resource"` } })
    }
    const status = error instanceof CrmError && error.code === 'invalid_origin' ? 403 : error instanceof CrmError && error.code === 'request_too_large' ? 413 : 503
    return Response.json({ error: status === 503 ? 'CRM MCP is unavailable. Check configuration and migrations.' : 'Request rejected.' }, { status, headers: noStore })
  } finally { await server?.close() }
}

// Stateless request/response MCP: no standalone event stream or sessions to delete.
export function GET() { return new Response(null, { status: 405, headers: { ...noStore, Allow: 'POST' } }) }
export function DELETE() { return new Response(null, { status: 405, headers: { ...noStore, Allow: 'POST' } }) }
