/* Boots the real OpenCode server (workerd profile) inside a Node/Vercel function.
   The workerd profile stubs local-only services; SQLite is backed by node:sqlite. */
import { Effect, Scope } from "effect"
import { DatabaseSync } from "node:sqlite"
import { ServerWorkerd } from "../../packages/server/src/workerd.ts"

type SqlValue = ArrayBuffer | string | number | null

function normalize(value: unknown): SqlValue {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof value === "bigint") return Number(value)
  if (value instanceof Uint8Array) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
  if (value instanceof ArrayBuffer) return value
  return String(value)
}

function makeStorage(): import("../../packages/core/src/database/sqlite.workerd.ts").DurableObjectStorage {
  const db = new DatabaseSync(":memory:")
  const exec = (query: string, ...bindings: Array<unknown>) => {
    const stmt = db.prepare(query)
    let columns: Array<string> = []
    try {
      columns = stmt.columns().map((column) => column.name)
    } catch {
      columns = []
    }
    const params = bindings.map((value) => (value instanceof Uint8Array ? Buffer.from(value) : value))
    const objects = columns.length ? (stmt.all(...params) as Array<Record<string, unknown>>) : []
    if (!columns.length) stmt.run(...params)
    const rows = objects.map((row) => columns.map((name) => normalize(row[name])))
    return {
      columnNames: columns,
      raw: () => rows[Symbol.iterator](),
      toArray: () => objects.map((row) => Object.fromEntries(columns.map((name) => [name, normalize(row[name])]))),
    }
  }
  return {
    sql: { exec },
    async transaction<T>(closure: (txn: { rollback(): void }) => Promise<T>): Promise<T> {
      let rolledBack = false
      db.exec("BEGIN")
      try {
        const result = await closure({ rollback: () => { rolledBack = true } })
        if (rolledBack) throw new Error("transaction rollback")
        db.exec("COMMIT")
        return result
      } catch (error) {
        try { db.exec("ROLLBACK") } catch {}
        throw error
      }
    },
    transactionSync<T>(closure: () => T): T {
      return closure()
    },
  } as import("../../packages/core/src/database/sqlite.workerd.ts").DurableObjectStorage
}

let pending: Promise<(request: Request) => Promise<Response>> | undefined

export function makeHandler(): Promise<(request: Request) => Promise<Response>> {
  if (pending) return pending
  pending = (async () => {
    // The scope owns the server's layer graph. Keeping it alive (never closing it)
    // keeps the database, event bus and route table warm for the whole function instance.
    const scope = await Effect.runPromise(Scope.make())
    const program = ServerWorkerd.create({
      storage: makeStorage(),
      config: { content: "{}" },
    })
    return await Effect.runPromise(Effect.provideService(program, Scope.Scope, scope))
  })()
  return pending
}
