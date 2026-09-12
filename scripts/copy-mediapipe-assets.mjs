import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const source = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm')
const destination = new URL('../public/mediapipe/wasm/', import.meta.url)

// Keep the runtime and installed JS versions in sync, with no CDN dependency.
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
