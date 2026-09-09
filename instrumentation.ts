// Vercel reserves the TZ deployment variable. Initialize Node's calendar before
// requests so existing UI counters and MCP writes share Stockholm day boundaries.
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') process.env.TZ = 'Europe/Stockholm'
}
