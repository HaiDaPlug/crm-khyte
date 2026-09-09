import 'server-only'
import { getDb } from '@/lib/db/pg'

export type Row = Record<string, unknown>
export interface Queryable {
  query<T extends Row = Row>(statement: string, parameters?: unknown[]): Promise<T[]>
}
export interface Database extends Queryable {
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>
}

/** Parameterized SQL shared by the MCP service and future voice actions. */
export function crmDatabase(): Database {
  const sql = getDb()
  const wrap = (connection: Pick<typeof sql, 'unsafe'>): Queryable => ({
    async query<T extends Row>(statement: string, parameters: unknown[] = []) {
      return await connection.unsafe(statement, parameters as never[]) as unknown as T[]
    },
  })
  return {
    ...wrap(sql),
    async transaction<T>(run: (tx: Queryable) => Promise<T>) {
      return await sql.begin(tx => run(wrap(tx))) as T
    },
  }
}
