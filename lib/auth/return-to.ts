/** Only the connection flow may request a post-login destination. No open redirects. */
export function loginReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 12000 || !value.startsWith('/oauth/authorize?')) return '/'
  const url = new URL(value, 'https://khyte.invalid')
  return url.origin === 'https://khyte.invalid' && url.pathname === '/oauth/authorize' ? `${url.pathname}${url.search}` : '/'
}
