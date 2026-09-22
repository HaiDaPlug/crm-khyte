import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { after, before, test } from 'node:test'

let server, origin, startup = ''
const secret = 'isolated-http-test-auth-secret'
const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }

before(async () => {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  origin = `http://127.0.0.1:${port}`
  // No database and no identity provider on purpose: this suite is about
  // what the gate does BEFORE either is consulted. There is no shared
  // password any more, so nothing here can log in.
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', AUTH_SECRET: secret,
      MCP_PUBLIC_URL: 'https://crm.example.test', MCP_SECRET: 'test-only-signing-key-at-least-32-characters',
      MCP_CLIENT_ID: 'test-chatgpt', MCP_CLIENT_SECRET: 'test-only-client-secret-at-least-32-characters',
      MCP_REDIRECT_URIS: 'https://chatgpt.com/connector_platform_oauth_redirect',
      SUPABASE_DB_URL: '', SUPABASE_SECRET_KEY: '', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' },
  })
  server.stdout.on('data', chunk => { startup += chunk.toString() })
  server.stderr.on('data', chunk => { startup += chunk.toString() })
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(interval); reject(new Error(`Server startup timed out: ${startup}`)) }, 45000)
    const interval = setInterval(() => {
      if (/Ready in/.test(startup)) { clearInterval(interval); clearTimeout(timeout); resolve() }
      else if (server.exitCode !== null) { clearInterval(interval); clearTimeout(timeout); reject(new Error(`Server stopped: ${startup}`)) }
    }, 100)
  })
  await ready
})
after(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve))
    server.kill()
    await stopped
  }
})

test('discovery routes are reachable without the browser session and report canonical resource/scopes', async () => {
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).resource, 'https://crm.example.test/mcp')
  }
  const response = await fetch(`${origin}/.well-known/oauth-authorization-server`)
  const data = await response.json()
  assert.equal(data.issuer, 'https://crm.example.test')
  assert.deepEqual(data.code_challenge_methods_supported, ['S256'])
  assert.ok(data.scopes_supported.includes('crm:tasks:write'))
})

test('MCP requires bearer auth, rejects foreign origins and never redirects protocol calls to login', async () => {
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: '{}', redirect: 'manual' })
  assert.equal(response.status, 401)
  assert.ok(response.headers.get('www-authenticate').includes('/.well-known/oauth-protected-resource'))
  const forbidden = await fetch(`${origin}/mcp`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })
  assert.equal(forbidden.status, 403)
  assert.equal((await fetch(`${origin}/mcp`)).status, 405)
  const snapshot = await fetch(`${origin}/api/snapshot`, { redirect: 'manual' })
  assert.equal(snapshot.status, 307)
  assert.ok(snapshot.headers.get('location').endsWith('/login'))
})

test('authorization and the app need a real session: no cookie and an unknown cookie both go to login', async () => {
  const params = new URLSearchParams({ response_type: 'code', client_id: 'test-chatgpt', redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    state: 'opaque-test-state', resource: 'https://crm.example.test/mcp', code_challenge: createHash('sha256').update('a'.repeat(64)).digest('base64url'),
    code_challenge_method: 'S256', scope: 'crm:read crm:tasks:write' })
  const url = `${origin}/oauth/authorize?${params}`
  const unauthenticated = await fetch(url, { redirect: 'manual' })
  assert.equal(unauthenticated.status, 303)
  const login = new URL(unauthenticated.headers.get('location'))
  assert.equal(login.pathname, '/login')
  assert.ok(login.searchParams.get('returnTo').startsWith('/oauth/authorize?'), 'consent resumes after login')

  // A cookie this server would have signed, for a session it never minted:
  // `<token>.<expiry>.<hmac>` (lib/auth/session.ts). The signature is the
  // optimistic check Proxy makes without I/O, so it passes Proxy; the
  // consent route then asks the database for the session and, with none
  // configured, finds nobody — the same answer a revoked session gets. The
  // old shared-password cookie used to be enough to reach the consent page;
  // it no longer can be, because a page that names whose identity the
  // connection will carry needs a person to name.
  const token = 'a'.repeat(43), expires = String(Date.now() + 60000)
  const cookie = `khyte_session=${token}.${expires}.${createHmac('sha256', secret).update(`${token}.${expires}`).digest('base64url')}`
  const unknown = await fetch(url, { headers: { cookie }, redirect: 'manual' })
  assert.equal(unknown.status, 303)
  assert.equal(new URL(unknown.headers.get('location')).pathname, '/login')
  // The same cookie opens no data either: Proxy forwards it, the route
  // resolves no session, and the answer is 401 rather than a redirect
  // (a fetch from the app, not a navigation).
  const snapshot = await fetch(`${origin}/api/snapshot`, { headers: { cookie }, redirect: 'manual' })
  assert.equal(snapshot.status, 401)
  // Without any cookie the app itself redirects to the gate.
  const bare = await fetch(`${origin}/api/snapshot`, { redirect: 'manual' })
  assert.equal(bare.status, 307)
  assert.ok(bare.headers.get('location').endsWith('/login'))
})
