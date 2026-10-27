/* Vercel function: runs the real OpenCode HTTP API (workerd runtime profile)
   in-process, so the deployed web app connects to location.origin like the
   official build does. Node 24 provides node:sqlite for the in-memory database. */
import { makeHandler } from "../lib/opencode-server.mjs"

let pending

export const config = {
  maxDuration: 60,
}

export default async function handler(request, res) {
  if (res && typeof res.writeHead === "function") return nodeStyle(request, res)
  pending ??= makeHandler()
  const handle = await pending
  return handle(request)
}

async function nodeStyle(req, res) {
  pending ??= makeHandler()
  const handle = await pending
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else if (value !== undefined) headers.set(key, value)
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : req
  const webRequest = new Request(`https://${req.headers.host ?? "localhost"}${req.url}`, {
    method: req.method,
    headers,
    body,
    duplex: "half",
  })
  const response = await handle(webRequest)
  res.statusCode = response.status
  for (const [key, value] of response.headers) res.setHeader(key, value)
  if (response.body) for await (const chunk of response.body) res.write(chunk)
  res.end()
}
