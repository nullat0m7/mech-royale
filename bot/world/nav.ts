/**
 * Walking navigation on a 2 m grid. Each cell stores the surface a mech would stand on there
 * (terrain, or the top of a low solid), whether that surface is a roof (only reachable by jetting),
 * and whether a wall is next to it. A* moves between 8-neighbours when the climb is at most
 * `step_up`, or the terrain slope is walkable; drops are always allowed.
 */
import type { World } from "./map.ts"

export const CELL = 2

export class Nav {
  w: World
  nx: number
  ny: number
  ox: number
  oy: number
  h: Float32Array // surface height
  roof: Uint8Array // 1 = surface is a prism top above step height (reachable only by jetting)
  wall: Uint8Array // 1 = a wall (impassable climb) next to this cell
  blocked: Uint8Array // 1 = never stand here (map edge, manual blacklist)
  comp: Int32Array // connected region id (cells mutually walkable), 0 = none
  compSize: Int32Array // cells per region id
  stepUp: number
  slopeTan: number
  // A* scratch
  private g: Float32Array
  private parent: Int32Array
  private seen: Uint32Array
  private closed: Uint32Array
  private gen = 1
  private heap: Int32Array
  private heapF: Float32Array
  private heapN = 0

  constructor(w: World, stepUp = 1.2, maxSlopeDeg = 50, mechHeight = 9) {
    this.w = w
    this.stepUp = stepUp
    this.slopeTan = Math.tan((maxSlopeDeg * Math.PI) / 180) * 0.9
    this.ox = w.minX
    this.oy = w.minY
    this.nx = Math.floor((w.maxX - w.minX) / CELL)
    this.ny = Math.floor((w.maxY - w.minY) / CELL)
    const n = this.nx * this.ny
    this.h = new Float32Array(n)
    this.roof = new Uint8Array(n)
    this.wall = new Uint8Array(n)
    this.blocked = new Uint8Array(n)
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i
        this.h[k] = w.ground(this.cx(i), this.cy(j))
        if (i < 2 || j < 2 || i >= this.nx - 2 || j >= this.ny - 2) this.blocked[k] = 1
      }
    // rasterize prisms: a solid whose underside is within a mech's height of the ground replaces the surface
    for (const p of w.prisms) {
      const i0 = Math.max(0, Math.floor((p.minX - this.ox) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((p.maxX - this.ox) / CELL))
      const j0 = Math.max(0, Math.floor((p.minY - this.oy) / CELL)), j1 = Math.min(this.ny - 1, Math.floor((p.maxY - this.oy) / CELL))
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = this.cx(i), y = this.cy(j)
          if (!w.inPrism2D(p, x, y)) continue
          const k = j * this.nx + i
          const gr = w.ground(x, y)
          if (p.base >= gr + mechHeight) continue // walk under it
          if (p.top > this.h[k]) {
            this.h[k] = p.top
            this.roof[k] = p.top > gr + stepUp ? 1 : 0
          }
        }
    }
    for (let j = 1; j < this.ny - 1; j++)
      for (let i = 1; i < this.nx - 1; i++) {
        const k = j * this.nx + i
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue
            if (!this.passable(k, k + dj * this.nx + di, di && dj ? CELL * Math.SQRT2 : CELL)) {
              this.wall[k] = 1
            }
          }
      }
    // regions of cells that can walk to each other both ways
    this.comp = new Int32Array(n)
    const queue = new Int32Array(n)
    let label = 0
    for (let k0 = 0; k0 < n; k0++) {
      if (this.comp[k0] || this.blocked[k0] || this.roof[k0]) continue
      label++
      let head = 0, tail = 0
      queue[tail++] = k0
      this.comp[k0] = label
      while (head < tail) {
        const k = queue[head++]
        const i = k % this.nx, j = (k / this.nx) | 0
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if ((!di && !dj) || (di && dj)) continue
            const ii = i + di, jj = j + dj
            if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue
            const m = jj * this.nx + ii
            if (this.comp[m] || this.roof[m]) continue
            if (this.passable(k, m, CELL) && this.passable(m, k, CELL)) {
              this.comp[m] = label
              queue[tail++] = m
            }
          }
      }
    }
    this.compSize = new Int32Array(label + 1)
    for (let k = 0; k < n; k++) this.compSize[this.comp[k]]++
    this.compSize[0] = 0
    this.g = new Float32Array(n)
    this.parent = new Int32Array(n)
    this.seen = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    this.heap = new Int32Array(n + 8)
    this.heapF = new Float32Array(n + 8)
  }

  cx(i: number) {
    return this.ox + (i + 0.5) * CELL
  }
  cy(j: number) {
    return this.oy + (j + 0.5) * CELL
  }
  cell(x: number, y: number): number {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.ox) / CELL)))
    const j = Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.oy) / CELL)))
    return j * this.nx + i
  }
  ci(k: number) {
    return k % this.nx
  }
  cj(k: number) {
    return (k / this.nx) | 0
  }

  /** Can a mech walk from cell a to the neighbouring cell b? */
  passable(a: number, b: number, d: number): boolean {
    if (this.blocked[b]) return false
    const dh = this.h[b] - this.h[a]
    if (dh <= this.stepUp) return true
    if (!this.roof[a] && !this.roof[b] && dh / d <= this.slopeTan) return true
    return false
  }

  /** Nearest cell to (x, y) that is ground level (not a roof) and not blocked, searching rings out to `maxR` cells. */
  nearestGround(x: number, y: number, maxR = 20): number {
    const k0 = this.cell(x, y)
    if (!this.roof[k0] && !this.blocked[k0]) return k0
    const i0 = this.ci(k0), j0 = this.cj(k0)
    for (let r = 1; r <= maxR; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const i = i0 + di, j = j0 + dj
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue
          const k = j * this.nx + i
          if (!this.roof[k] && !this.blocked[k]) return k
        }
    return k0
  }

  /** Can a mech standing at (ax, ay) walk to (bx, by)? (same region, allowing a cell of slack at the goal) */
  reachable(ax: number, ay: number, bx: number, by: number): boolean {
    const c = this.comp[this.cell(ax, ay)]
    if (!c) return true // on a roof or unknown: assume yes, A* will try
    for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (this.comp[this.cell(bx + dx, by + dy)] === c) return true
    return false
  }

  /** Nearest cell to (x, y) in region `comp` (0 = any ground cell), searching rings out to `maxR` cells. */
  snap(x: number, y: number, comp: number, maxR = 60): number {
    if (!comp) return this.nearestGround(x, y, maxR)
    const k0 = this.cell(x, y)
    if (this.comp[k0] === comp && !this.blocked[k0]) return k0
    const i0 = this.ci(k0), j0 = this.cj(k0)
    for (let r = 1; r <= maxR; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const i = i0 + di, j = j0 + dj
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue
          const k = j * this.nx + i
          if (this.comp[k] === comp && !this.blocked[k]) return k
        }
    return this.nearestGround(x, y)
  }

  private push(k: number, f: number) {
    let i = this.heapN++
    const H = this.heap, F = this.heapF
    while (i > 0) {
      const p = (i - 1) >> 1
      if (F[p] <= f) break
      H[i] = H[p]
      F[i] = F[p]
      i = p
    }
    H[i] = k
    F[i] = f
  }
  private pop(): number {
    const H = this.heap, F = this.heapF
    const top = H[0]
    const n = --this.heapN
    const k = H[n], f = F[n]
    let i = 0
    while (true) {
      let c = 2 * i + 1
      if (c >= n) break
      if (c + 1 < n && F[c + 1] < F[c]) c++
      if (F[c] >= f) break
      H[i] = H[c]
      F[i] = F[c]
      i = c
    }
    H[i] = k
    F[i] = f
    return top
  }

  /**
   * A* from (sx, sy) to (tx, ty). Returns cell indices from start to goal (or to the closest reached
   * cell when the expansion budget runs out or the goal is unreachable), or null.
   */
  path(sx: number, sy: number, tx: number, ty: number, maxExpand = 60000, weight = 1.3): number[] | null {
    const s = this.cell(sx, sy)
    // aim for the reachable cell nearest the goal: our own region when we are in one
    const t = this.snap(tx, ty, this.comp[s])
    if (++this.gen === 0xffffffff) {
      this.seen.fill(0)
      this.closed.fill(0)
      this.gen = 1
    }
    const gen = this.gen
    const nx = this.nx
    const ti = this.ci(t), tj = this.cj(t)
    const hfun = (k: number) => {
      const dx = Math.abs(this.ci(k) - ti), dy = Math.abs(this.cj(k) - tj)
      return CELL * (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * weight
    }
    this.heapN = 0
    this.g[s] = 0
    this.seen[s] = gen
    this.parent[s] = -1
    this.push(s, hfun(s))
    let best = s, bestH = hfun(s)
    let expanded = 0
    while (this.heapN > 0 && expanded < maxExpand) {
      const k = this.pop()
      if (this.closed[k] === gen) continue
      this.closed[k] = gen
      expanded++
      if (k === t) {
        best = k
        break
      }
      const hk = hfun(k)
      if (hk < bestH) {
        bestH = hk
        best = k
      }
      const i = k % nx, j = (k / nx) | 0
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj
        if (jj < 0 || jj >= this.ny) continue
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue
          const ii = i + di
          if (ii < 0 || ii >= nx) continue
          const n = jj * nx + ii
          if (this.closed[n] === gen) continue
          const diag = di !== 0 && dj !== 0
          const d = diag ? CELL * Math.SQRT2 : CELL
          if (!this.passable(k, n, d)) continue
          // no corner cutting past walls
          if (diag && (!this.passable(k, j * nx + ii, CELL) || !this.passable(k, jj * nx + i, CELL))) continue
          const cost = this.g[k] + d * (1 + 2.5 * this.wall[n])
          if (this.seen[n] === gen && cost >= this.g[n]) continue
          this.seen[n] = gen
          this.g[n] = cost
          this.parent[n] = k
          this.push(n, cost + hfun(n))
        }
      }
    }
    const out: number[] = []
    for (let k = best; k !== -1; k = this.parent[k]) {
      out.push(k)
      if (out.length > 100000) return null
    }
    out.reverse()
    return out
  }

  /** Walkable straight line between two points (every grid step along it passable)? */
  lineWalkable(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay)
    const n = Math.max(1, Math.ceil(d / (CELL * 0.5)))
    let prev = this.cell(ax, ay)
    for (let s = 1; s <= n; s++) {
      const k = this.cell(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n)
      if (k === prev) continue
      if (!this.passable(prev, k, CELL) || this.wall[k]) return false
      prev = k
    }
    return true
  }
}
