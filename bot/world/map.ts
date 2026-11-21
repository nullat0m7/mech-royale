/**
 * Static world model (protocol.md section 11): terrain heights, solid prisms, and ray tests against them.
 * Trees are loaded for vision estimates only; they never stop shots.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pointInRing, segCylInterval } from "./geom.ts"

export type Prism = {
  kind: string
  base: number
  top: number
  ring: Float64Array
  holes: Float64Array[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const HASH = 16 // spatial hash cell, meters

export class World {
  minX: number
  minY: number
  maxX: number
  maxY: number
  // terrain
  tMinX: number
  tMinY: number
  tStep: number
  nx: number
  ny: number
  heights: Float32Array
  prisms: Prism[] = []
  // spatial hash of prisms
  hnx: number
  hny: number
  cells: number[][]
  private stamp: Uint32Array
  private stampN = 1
  // trees (vision only): flat arrays; crowns are vertical cylinders from crownBase to height
  nTrees = 0
  tree: Float64Array = new Float64Array(0) // per tree: x, y, z, height, crownR, crownBase, trunkR, crownX, crownY
  treeCells: number[][] = []
  private treeStamp: Uint32Array = new Uint32Array(0)
  private treeStampN = 1
  /** Crown path length (m) beyond which sight is blocked: ln(1 / canopyBlockT) / canopyDensity. */
  canopyMaxLen = Infinity

  constructor(worldJson: any, terrain: Uint8Array) {
    const b = worldJson.bounds
    this.minX = b.minX
    this.minY = b.minY
    this.maxX = b.maxX
    this.maxY = b.maxY
    const t = worldJson.terrain
    this.tMinX = t.minX
    this.tMinY = t.minY
    this.tStep = t.step
    this.nx = t.nx
    this.ny = t.ny
    const scale = t.scale ?? 0.01
    const view = new DataView(terrain.buffer, terrain.byteOffset, terrain.byteLength)
    this.heights = new Float32Array(this.nx * this.ny)
    for (let i = 0; i < this.heights.length; i++) this.heights[i] = view.getInt16(i * 2, true) * scale
    for (const p of worldJson.prisms) {
      const ring = Float64Array.from(p.ring as number[])
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i < ring.length; i += 2) {
        if (ring[i] < minX) minX = ring[i]
        if (ring[i] > maxX) maxX = ring[i]
        if (ring[i + 1] < minY) minY = ring[i + 1]
        if (ring[i + 1] > maxY) maxY = ring[i + 1]
      }
      const holes = ((p.holes ?? []) as number[][]).filter((h) => h.length >= 6).map((h) => Float64Array.from(h))
      this.prisms.push({ kind: p.kind, base: p.base, top: p.top, ring, holes, minX, minY, maxX, maxY })
    }
    this.hnx = Math.ceil((this.maxX - this.minX) / HASH) + 1
    this.hny = Math.ceil((this.maxY - this.minY) / HASH) + 1
    this.cells = Array.from({ length: this.hnx * this.hny }, () => [])
    this.prisms.forEach((p, idx) => {
      const i0 = this.hx(p.minX), i1 = this.hx(p.maxX), j0 = this.hy(p.minY), j1 = this.hy(p.maxY)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.hnx + i].push(idx)
    })
    this.stamp = new Uint32Array(this.prisms.length)
    const tr = worldJson.trees
    if (tr && Array.isArray(tr.data)) {
      const f: string[] = tr.fields
      const col = (n: string) => f.indexOf(n)
      const nf = f.length
      this.nTrees = Math.floor(tr.data.length / nf)
      this.tree = new Float64Array(this.nTrees * 9)
      const names = ["x", "y", "z", "height", "crownR", "crownBase", "trunkR", "crownX", "crownY"]
      for (let i = 0; i < this.nTrees; i++)
        names.forEach((n, k) => {
          const c = col(n)
          this.tree[i * 9 + k] = c >= 0 ? tr.data[i * nf + c] : k === 7 ? tr.data[i * nf + col("x")] : k === 8 ? tr.data[i * nf + col("y")] : 0
        })
      this.treeCells = Array.from({ length: this.hnx * this.hny }, () => [])
      for (let i = 0; i < this.nTrees; i++) {
        const T = this.tree, o = i * 9
        const r = Math.max(T[o + 4], T[o + 6]) + Math.hypot(T[o + 7] - T[o], T[o + 8] - T[o + 1])
        for (let j = this.hy(T[o + 1] - r); j <= this.hy(T[o + 1] + r); j++)
          for (let k = this.hx(T[o] - r); k <= this.hx(T[o] + r); k++) this.treeCells[j * this.hnx + k].push(i)
      }
      this.treeStamp = new Uint32Array(this.nTrees)
      const rules = worldJson.rules ?? {}
      if (rules.canopyDensity > 0 && rules.canopyBlockT > 0) this.canopyMaxLen = Math.log(1 / rules.canopyBlockT) / rules.canopyDensity
    }
  }

  /** Do trees block sight along a→b? Trunks block; crowns block when the path through them is long. */
  treesBlock(a: number[], b: number[]): boolean {
    if (!this.nTrees) return false
    if (++this.treeStampN === 0xffffffff) {
      this.treeStamp.fill(0)
      this.treeStampN = 1
    }
    const n = this.treeStampN
    const T = this.tree
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    let crown = 0
    const samples = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (HASH / 2)))
    for (let s = 0; s <= samples; s++) {
      const t = s / samples
      const cell = this.hy(a[1] + (b[1] - a[1]) * t) * this.hnx + this.hx(a[0] + (b[0] - a[0]) * t)
      for (const i of this.treeCells[cell]) {
        if (this.treeStamp[i] === n) continue
        this.treeStamp[i] = n
        const o = i * 9
        const z = T[o + 2]
        if (segCylInterval(a, b, T[o], T[o + 1], z, z + T[o + 3], T[o + 6])) return true
        const iv = segCylInterval(a, b, T[o + 7], T[o + 8], z + T[o + 5], z + T[o + 3], T[o + 4])
        if (iv) {
          crown += (iv[1] - iv[0]) * len
          if (crown > this.canopyMaxLen) return true
        }
      }
    }
    return false
  }

  /** Line of sight: what shots hit, plus trees. */
  sightClear(a: number[], b: number[]): boolean {
    return this.rayHit(a, b) > 1 && !this.treesBlock(a, b)
  }

  static load(dir: string): World {
    const json = JSON.parse(readFileSync(join(dir, "v2/world.json"), "utf8"))
    const terr = readFileSync(join(dir, "v2/terrain.i16"))
    return new World(json, new Uint8Array(terr.buffer, terr.byteOffset, terr.byteLength))
  }

  private hx(x: number) {
    return Math.min(this.hnx - 1, Math.max(0, Math.floor((x - this.minX) / HASH)))
  }
  private hy(y: number) {
    return Math.min(this.hny - 1, Math.max(0, Math.floor((y - this.minY) / HASH)))
  }

  /** Ground height (terrain only), bilinear. */
  ground(x: number, y: number): number {
    let fx = (x - this.tMinX) / this.tStep
    let fy = (y - this.tMinY) / this.tStep
    if (fx < 0) fx = 0
    if (fy < 0) fy = 0
    if (fx > this.nx - 1.001) fx = this.nx - 1.001
    if (fy > this.ny - 1.001) fy = this.ny - 1.001
    const i = fx | 0, j = fy | 0
    const u = fx - i, v = fy - j
    const k = j * this.nx + i
    const h = this.heights
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + this.nx] * (1 - u) + h[k + this.nx + 1] * u) * v
  }

  inPrism2D(p: Prism, x: number, y: number): boolean {
    if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return false
    if (!pointInRing(p.ring, x, y)) return false
    for (const h of p.holes) if (pointInRing(h, x, y)) return false
    return true
  }

  /** Indices of prisms whose footprint contains (x, y). */
  prismsAt(x: number, y: number): number[] {
    const out: number[] = []
    for (const idx of this.cells[this.hy(y) * this.hnx + this.hx(x)]) if (this.inPrism2D(this.prisms[idx], x, y)) out.push(idx)
    return out
  }

  /** Is the point inside a solid? */
  solidAt(x: number, y: number, z: number): boolean {
    if (z < this.ground(x, y) - 0.05) return true
    for (const idx of this.prismsAt(x, y)) {
      const p = this.prisms[idx]
      if (z >= p.base && z <= p.top) return true
    }
    return false
  }

  /** First hit parameter t in [0, 1] of segment a→b with a prism, or 2 when clear. */
  private prismHit(p: Prism, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    if (Math.max(az, bz) < p.base || Math.min(az, bz) > p.top) return 2
    if (Math.max(ax, bx) < p.minX || Math.min(ax, bx) > p.maxX || Math.max(ay, by) < p.minY || Math.min(ay, by) > p.maxY) return 2
    const ts: number[] = [0, 1]
    const dx = bx - ax, dy = by - ay
    const edges = (r: Float64Array) => {
      const n = r.length
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const ex = r[i] - r[j], ey = r[i + 1] - r[j + 1]
        const den = dx * ey - dy * ex
        if (Math.abs(den) < 1e-12) continue
        const wx = r[j] - ax, wy = r[j + 1] - ay
        const t = (wx * ey - wy * ex) / den
        const s = (wx * dy - wy * dx) / den
        if (t > 0 && t < 1 && s >= 0 && s <= 1) ts.push(t)
      }
    }
    edges(p.ring)
    for (const h of p.holes) edges(h)
    ts.sort((a, b) => a - b)
    const dz = bz - az
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k], t1 = ts[k + 1]
      if (t1 - t0 < 1e-9) continue
      const tm = (t0 + t1) / 2
      if (!this.inPrism2D(p, ax + dx * tm, ay + dy * tm)) continue
      let lo = t0, hi = t1
      if (Math.abs(dz) < 1e-9) {
        if (az < p.base || az > p.top) continue
      } else {
        const ta = (p.base - az) / dz, tb = (p.top - az) / dz
        lo = Math.max(t0, Math.min(ta, tb))
        hi = Math.min(t1, Math.max(ta, tb))
      }
      if (lo <= hi) return lo
    }
    return 2
  }

  /**
   * First hit t in [0, 1] along a→b against prisms and terrain (what stops shots), or 2 when clear.
   * Terrain is sampled every `step` meters.
   */
  rayHit(a: number[], b: number[], step = 2): number {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2]
    let best = 2
    // prisms via the spatial hash, walking cells along the segment
    const n = ++this.stampN
    if (n === 0xffffffff) {
      this.stamp.fill(0)
      this.stampN = 1
    }
    const len2 = Math.hypot(bx - ax, by - ay)
    const samples = Math.max(1, Math.ceil(len2 / (HASH / 2)))
    let lastCell = -1
    for (let s = 0; s <= samples; s++) {
      const t = s / samples
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
      const ci = this.hx(x), cj = this.hy(y)
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj
          if (i < 0 || j < 0 || i >= this.hnx || j >= this.hny) continue
          const cell = j * this.hnx + i
          if (cell === lastCell) continue
          for (const idx of this.cells[cell]) {
            if (this.stamp[idx] === this.stampN) continue
            this.stamp[idx] = this.stampN
            const h = this.prismHit(this.prisms[idx], ax, ay, az, bx, by, bz)
            if (h < best) best = h
          }
        }
      lastCell = cj * this.hnx + ci
    }
    // terrain
    const len = Math.hypot(bx - ax, by - ay, bz - az)
    const m = Math.max(2, Math.ceil(len / step))
    const tEnd = Math.min(best, 1)
    for (let s = 1; s < m; s++) {
      const t = s / m
      if (t >= tEnd) break
      const z = az + (bz - az) * t
      if (z < this.ground(ax + (bx - ax) * t, ay + (by - ay) * t) - 0.1) return t
    }
    return best
  }

  clear(a: number[], b: number[]): boolean {
    return this.rayHit(a, b) > 1
  }
}
