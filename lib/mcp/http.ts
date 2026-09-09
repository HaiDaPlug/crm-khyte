import 'server-only'
import { CrmError } from '@/lib/crm/errors'
import { config } from './security'

export const noStore = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' }

export function checkOrigin(request: Request, requireOrigin = false) {
  const origin = request.headers.get('origin')
  if ((requireOrigin && !origin) || (origin && origin !== config().origin)) throw new CrmError('invalid_origin', 'Request origin is not permitted.')
}

export async function readBody(request: Request, maxBytes = 64 * 1024) {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new CrmError('request_too_large', 'Request body is too large.')
  const reader = request.body?.getReader()
  if (!reader) return ''
  let size = 0, body = ''
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new CrmError('request_too_large', 'Request body is too large.') }
      body += decoder.decode(value, { stream: true })
    }
    return body + decoder.decode()
  } finally { reader.releaseLock() }
}

export function oauthError(error: unknown) {
  const known = error instanceof CrmError
  const status = known && error.code === 'invalid_client' ? 401 : known && error.code === 'not_configured' ? 503 : 400
  return Response.json({ error: known ? error.code : 'invalid_request', error_description: known ? error.message : 'Unable to complete the connection request.' }, { status, headers: noStore })
}
