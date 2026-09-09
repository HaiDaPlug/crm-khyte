import { crmDatabase } from '@/lib/crm/database'
import { revokeToken } from '@/lib/mcp/oauth'
import { checkOrigin, noStore, oauthError, readBody } from '@/lib/mcp/http'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    checkOrigin(request)
    await revokeToken(crmDatabase(), new URLSearchParams(await readBody(request, 16000)))
    return new Response(null, { status: 200, headers: noStore })
  } catch (error) { return oauthError(error) }
}
