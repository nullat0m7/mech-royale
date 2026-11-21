/**
 * Exposure map: for each 4 m cell, how much of the surrounding ground can see a mech standing there (0 = hidden
 * from every sampled spot, 255 = seen from all). Built offline by tools/exposure.ts and shipped in bot/data; the
 * header carries a signature of the map so a different map turns it off instead of misleading the bot.
 */
import { readFileSync } from "node:fs"
import type { World } from "./map.ts"

export const EXPOSURE_STEP = 4

type Header = { step: number; ox: number; oy: number; nx: number; ny: number; sig: string }

/** A short fingerprint of the static map: counts, bounds and a checksum of every prism. */
export function worldSignature(w: World): string {
  let h = 0
  for (const p of w.prisms) {
    h = (h * 31 + Math.round(p.top * 10) + Math.round(p.base * 10) + p.ring.length) | 0
    for (let i = 0; i < p.ring.length; i += 7) h = (h * 31 + Math.round(p.ring[i] * 10)) | 0
  }
  return `${w.prisms.length}/${w.nTrees}/${Math.round(w.minX)},${Math.round(w.minY)},${Math.round(w.maxX)},${Math.round(w.maxY)}/${h >>> 0}`
}

/** File layout: 4-byte little-endian header length, JSON header, then nx*ny bytes. */
export function encodeExposure(h: Header, data: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(h))
  const out = new Uint8Array(4 + head.length + data.length)
  new DataView(out.buffer).setUint32(0, head.length, true)
  out.set(head, 4)
  out.set(data, 4 + head.length)
  return out
}

export class Exposure {
  h: Header
  data: Uint8Array
  constructor(h: Header, data: Uint8Array) {
    this.h = h
    this.data = data
  }

  /** Load from `path`; null when missing, malformed or built for another map. */
  static load(path: string, w: World): Exposure | null {
    try {
      const b = readFileSync(path)
      const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
      const n = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(0, true)
      const h = JSON.parse(new TextDecoder().decode(u.subarray(4, 4 + n))) as Header
      const data = u.slice(4 + n)
      if (h.sig !== worldSignature(w) || data.length !== h.nx * h.ny) return null
      return new Exposure(h, data)
    } catch {
      return null
    }
  }

  /** Exposure at (x, y) in [0, 1]; 1 outside the grid. */
  at(x: number, y: number): number {
    const i = Math.floor((x - this.h.ox) / this.h.step), j = Math.floor((y - this.h.oy) / this.h.step)
    if (i < 0 || j < 0 || i >= this.h.nx || j >= this.h.ny) return 1
    return this.data[j * this.h.nx + i] / 255
  }
}
