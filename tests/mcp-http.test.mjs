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
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', AUTH_SECRET: secret, AUTH_PASSWORD: 'test-password',
      MCP_PUBLIC_URL: 'https://crm.example.test', MCP_SECRET: 'test-only-signing-key-at-least-32-characters',
      MCP_CLIENT_ID: 'test-chatgpt', MCP_CLIENT_SECRET: 'test-only-client-secret-at-least-32-characters',
      MCP_REDIRECT_URIS: 'https://chatgpt.com/connector_platform_oauth_redirect',
      SUPABASE_DB_URL: '', SUPABASE_SECRET_KEY: '', NEXT_PUBLIC_SUPABASE_URL: '' },
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

test('authorization requires the shared session and explicit same-origin consent', async () => {
  const params = new URLSearchParams({ response_type: 'code', client_id: 'test-chatgpt', redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    state: 'opaque-test-state', resource: 'https://crm.example.test/mcp', code_challenge: createHash('sha256').update('a'.repeat(64)).digest('base64url'),
    code_challenge_method: 'S256', scope: 'crm:read crm:tasks:write' })
  const url = `${origin}/oauth/authorize?${params}`
  const unauthenticated = await fetch(url, { redirect: 'manual' })
  assert.equal(unauthenticated.status, 303)
  assert.equal(new URL(unauthenticated.headers.get('location')).pathname, '/login')
  const expires = String(Date.now() + 60000)
  const cookie = `khyte_session=${expires}.${createHmac('sha256', secret).update(expires).digest('base64url')}`
  const page = await fetch(url, { headers: { cookie } })
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  // Under 'no-referrer' the browser serializes this page's own same-origin form
  // POST as 'Origin: null' (Fetch, "append a request Origin header"), which the
  // consent handler then refuses as invalid_origin. 'same-origin' still withholds
  // the referrer from the cross-origin callback, but keeps a real Origin here.
  assert.equal(page.headers.get('referrer-policy'), 'same-origin')
  // Chrome applies form-action to the redirect that follows the submission, so
  // the callback origin must be listed or approval navigates nowhere at all.
  const csp = page.headers.get('content-security-policy')
  assert.ok(csp.includes("form-action 'self' https://chatgpt.com;"), csp)
  assert.ok(csp.includes("frame-ancestors 'none'"), csp)
  const html = await page.text()
  assert.ok(html.includes('Ni kan fortfarande logga för varandra'))
  const approval = /name="approval" value="([^"]+)"/.exec(html)[1]
  const form = new URLSearchParams({ approval, decision: 'deny' })
  const missingOrigin = await fetch(`${origin}/oauth/authorize`, { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' })
  assert.equal(missingOrigin.status, 400)
  const nulledOrigin = await fetch(`${origin}/oauth/authorize`, { method: 'POST', headers: { cookie, origin: 'null' }, body: form, redirect: 'manual' })
  assert.equal(nulledOrigin.status, 400)
  const denied = await fetch(`${origin}/oauth/authorize`, { method: 'POST', headers: { cookie, origin: 'https://crm.example.test' }, body: form, redirect: 'manual' })
  assert.equal(denied.status, 303)
  const callback = new URL(denied.headers.get('location'))
  assert.equal(callback.searchParams.get('error'), 'access_denied')
  assert.equal(callback.searchParams.get('state'), 'opaque-test-state')
})
