/**
 * Test-only: blanks the `server-only` marker before anything imports it.
 *
 * `server-only` is a marker package, not a runtime: its default entry point is
 * a bare `throw`, and Next's bundler swaps it for an empty module in every
 * build where the import is legitimate (the `react-server` export condition).
 * Plain Node cannot alias per runtime, so a client module that transitively
 * reaches a `import 'server-only'` file explodes at import time for a reason
 * that has nothing to do with what is being tested.
 *
 * Seeding the require cache with an empty module removes exactly that
 * import-time marker and nothing else. No function is replaced, no module is
 * mocked: every module the store loads is the real one, and every assertion
 * runs against the real code. The suite runs WITHOUT --conditions=react-server
 * so that next/navigation resolves to its client build (React.createContext
 * exists there), which is why the marker has to be dealt with here instead.
 */
require.cache[require.resolve('server-only', { paths: [process.cwd()] })] = { exports: {} }
