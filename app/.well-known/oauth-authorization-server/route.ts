import { authorizationMetadata } from '@/lib/mcp/oauth'
import { noStore, oauthError } from '@/lib/mcp/http'
export const dynamic = 'force-dynamic'
export function GET() {
  try { return Response.json(authorizationMetadata(), { headers: noStore }) } catch (error) { return oauthError(error) }
}
