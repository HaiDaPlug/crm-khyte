import { crmDatabase } from '@/lib/crm/database'
import { exchangeToken } from '@/lib/mcp/oauth'
import { checkOrigin, noStore, oauthError, readBody } from '@/lib/mcp/http'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    checkOrigin(request)
    const result = await exchangeToken(crmDatabase(), new URLSearchParams(await readBody(request, 16000)))
    return Response.json(result, { headers: noStore })
  } catch (error) { return oauthError(error) }
}
