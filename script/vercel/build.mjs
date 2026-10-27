#!/usr/bin/env bun
/**
 * Regenerates lib/opencode-server.mjs — the prebundled OpenCode API server used
 * by the Vercel function in api/opencode.js.
 *
 * Run from the repository root after `bun install`:
 *   bun script/vercel/build.mjs
 *
 * The `workerd` condition swaps the local-only services (pty, filesystem,
 * plugins, ...) for inert stubs. node:sqlite supplies the database, so the
 * bundle runs on Vercel's Node 24 runtime without any native addons.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const jsonc = path.join(
  root,
  "node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js",
)

const result = await Bun.build({
  entrypoints: [path.join(root, "script/vercel/entry.ts")],
  conditions: ["workerd"],
  target: "node",
  format: "esm",
  outdir: path.join(root, "lib"),
  external: ["node:sqlite", "@aws-sdk/signature-v4-crt"],
  naming: { entry: "opencode-server.mjs" },
  minify: true,
  plugins: [
    {
      name: "jsonc-parser-esm",
      setup(build) {
        // The UMD build uses require("./impl/*"), which breaks in an ESM bundle.
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({ path: jsonc }))
      },
    },
  ],
  throw: false,
})

if (!result.success) {
  for (const log of result.logs) console.error(String(log))
  process.exit(1)
}
for (const output of result.outputs) console.log(`wrote ${output.path} (${output.size} bytes)`)
