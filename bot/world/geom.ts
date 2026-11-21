/** Small geometry helpers shared by the bot and the simulator. Frame: x east, y north, z up, meters. */

export type V2 = [number, number]
export type V3 = [number, number, number]

export const TAU = Math.PI * 2

/** Wrap an angle to [-pi, pi). */
export function wrap(a: number): number {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}

export const dist2 = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay)
export const dist3 = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Yaw and pitch of the direction from `from` to `to`. */
export function aimAt(from: number[], to: number[]): V2 {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  return [Math.atan2(dy, dx), Math.atan2(to[2] - from[2], Math.hypot(dx, dy))]
}

/** Angle between two aims (yaw, pitch), in radians, via their direction vectors. */
export function aimError(a: number[], b: number[]): number {
  const ax = Math.cos(a[1]) * Math.cos(a[0]), ay = Math.cos(a[1]) * Math.sin(a[0]), az = Math.sin(a[1])
  const bx = Math.cos(b[1]) * Math.cos(b[0]), by = Math.cos(b[1]) * Math.sin(b[0]), bz = Math.sin(b[1])
  return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1))
}

/**
 * Time for a straight projectile of `speed` fired from `from` to meet a target at `p` moving with
 * constant velocity `v`. Returns the intercept time, or -1 when it cannot catch up.
 */
export function interceptTime(from: number[], p: number[], v: number[], speed: number): number {
  const rx = p[0] - from[0], ry = p[1] - from[1], rz = p[2] - from[2]
  const a = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] - speed * speed
  const b = 2 * (rx * v[0] + ry * v[1] + rz * v[2])
  const c = rx * rx + ry * ry + rz * rz
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : -1
  const disc = b * b - 4 * a * c
  if (disc < 0) return -1
  const s = Math.sqrt(disc)
  const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a)
  const t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2)
  return t > 0 ? t : -1
}

/**
 * Launch pitch for a ballistic shell (speed v, gravity g) to cover horizontal distance d and rise h.
 * `high` picks the lofted solution. Returns NaN when out of range.
 */
export function ballisticPitch(d: number, h: number, v: number, g: number, high: boolean): number {
  const v2 = v * v
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2)
  if (disc < 0 || d < 1e-6) return NaN
  const s = Math.sqrt(disc)
  return Math.atan((v2 + (high ? s : -s)) / (g * d))
}

/** Flight time of a shell launched at `pitch` covering horizontal distance d. */
export const ballisticTime = (d: number, pitch: number, v: number) => d / (v * Math.cos(pitch))

/** Even-odd point-in-polygon on a flat [x0, y0, x1, y1, ...] ring. */
export function pointInRing(ring: ArrayLike<number>, x: number, y: number): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Parameter interval [t0, t1] within [0, 1] where segment a→b is inside the vertical cylinder centred
 * at (cx, cy) with radius r between heights z0 and z1, or null when it misses.
 */
export function segCylInterval(a: number[], b: number[], cx: number, cy: number, z0: number, z1: number, r: number): [number, number] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const fx = a[0] - cx, fy = a[1] - cy
  const A = dx * dx + dy * dy
  let t0 = 0, t1 = 1
  if (A < 1e-12) {
    if (fx * fx + fy * fy > r * r) return null
  } else {
    const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r
    const disc = B * B - 4 * A * C
    if (disc < 0) return null
    const sq = Math.sqrt(disc)
    t0 = Math.max(t0, (-B - sq) / (2 * A))
    t1 = Math.min(t1, (-B + sq) / (2 * A))
    if (t0 > t1) return null
  }
  const dz = b[2] - a[2]
  if (Math.abs(dz) < 1e-9) {
    if (a[2] < z0 || a[2] > z1) return null
  } else {
    const ta = (z0 - a[2]) / dz, tb = (z1 - a[2]) / dz
    t0 = Math.max(t0, Math.min(ta, tb))
    t1 = Math.min(t1, Math.max(ta, tb))
    if (t0 > t1) return null
  }
  return [t0, t1]
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
