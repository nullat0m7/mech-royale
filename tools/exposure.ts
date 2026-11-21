/**
 * Precompute the exposure map shipped in the image (bot/data/exposure.bin): for every 4 m cell, the share of
 * standing eye points around it (24 bearings x 40/80/130/200 m) that can see a mech's eye standing there. Low
 * exposure = few places see you. The map never changes between matches (protocol.md section 11), so this runs
 * offline once; the bot only looks values up.
 *
 *   node tools/exposure.ts            # writes bot/data/exposure.bin (worker threads, about a minute)
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads"
import { availableParallelism } from "node:os"
import { World } from "../bot/world/map.ts"
import { Nav } from "../bot/world/nav.ts"
import { EXPOSURE_STEP, encodeExposure, worldSignature } from "../bot/world/exposure.ts"

const ROOT = new URL("..", import.meta.url).pathname
const ARENA = ROOT + "mechfight-kit/arena"
const BEARINGS = 24
const DISTS = [40, 80, 130, 200]
const NEAR = 45 // proximity sensors see through canopy (protocol.md section 8)

function grid(world: World) {
  const nx = Math.floor((world.maxX - world.minX) / EXPOSURE_STEP)
  const ny = Math.floor((world.maxY - world.minY) / EXPOSURE_STEP)
  return { nx, ny }
}

function rows(world: World, nav: Nav, j0: number, j1: number): Uint8Array {
  const { nx } = grid(world)
  const out = new Uint8Array((j1 - j0) * nx)
  for (let j = j0; j < j1; j++)
    for (let i = 0; i < nx; i++) {
      const x = world.minX + (i + 0.5) * EXPOSURE_STEP, y = world.minY + (j + 0.5) * EXPOSURE_STEP
      const a = [x, y, nav.h[nav.cell(x, y)] + 8]
      let clear = 0, total = 0
      for (let b = 0; b < BEARINGS; b++) {
        const ang = (b / BEARINGS) * Math.PI * 2
        for (const d of DISTS) {
          const qx = x + Math.cos(ang) * d, qy = y + Math.sin(ang) * d
          if (qx < world.minX + 2 || qy < world.minY + 2 || qx > world.maxX - 2 || qy > world.maxY - 2) continue
          total++
          if (world.sightClear([qx, qy, nav.h[nav.cell(qx, qy)] + 8], a, d > NEAR)) clear++
        }
      }
      out[(j - j0) * nx + i] = total ? Math.round((255 * clear) / total) : 0
    }
  return out
}

if (isMainThread) {
  const t0 = performance.now()
  const world = World.load(ARENA)
  const { nx, ny } = grid(world)
  const n = Math.max(1, availableParallelism() - 1)
  const parts: Uint8Array[] = new Array(n)
  const per = Math.ceil(ny / n)
  await Promise.all(
    Array.from({ length: n }, (_, k) =>
      new Promise<void>((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { j0: k * per, j1: Math.min(ny, (k + 1) * per) } })
        w.on("message", (u: Uint8Array) => (parts[k] = u))
        w.on("error", reject)
        w.on("exit", () => resolve())
      }),
    ),
  )
  const data = new Uint8Array(nx * ny)
  let off = 0
  for (const p of parts) {
    data.set(p, off)
    off += p.length
  }
  mkdirSync(ROOT + "bot/data", { recursive: true })
  const bytes = encodeExposure({ step: EXPOSURE_STEP, ox: world.minX, oy: world.minY, nx, ny, sig: worldSignature(world) }, data)
  writeFileSync(ROOT + "bot/data/exposure.bin", bytes)
  let sum = 0
  for (const v of data) sum += v
  console.log(`exposure ${nx}x${ny} cells, mean ${(sum / data.length / 2.55).toFixed(1)}%, ${bytes.length} bytes, ${((performance.now() - t0) / 1000).toFixed(1)} s`)
} else {
  const { j0, j1 } = workerData as { j0: number; j1: number }
  const world = World.load(ARENA)
  const nav = new Nav(world)
  parentPort!.postMessage(rows(world, nav, j0, j1))
}
