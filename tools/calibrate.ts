/**
 * Does the simulator rank bot versions the way the real practice board did? Replays every scored version as a
 * MECH_PARAMS delta on the current code (same seeds for all) and prints sim points next to the real score.
 *
 *   node tools/calibrate.ts [--matches 960] [--workers 8] [--only 65ce172,6df0e10]
 *   HOUSE_PARAMS='{"joinPerKill":2}' node tools/calibrate.ts   # try a different house squad model
 *
 * Use the sim to screen candidates only while its order matches the real one (docs/bot.md, Simulator).
 */
import { execFileSync } from "node:child_process"

const ROOT = new URL("..", import.meta.url).pathname
// features added after the scored versions, switched off so every version replays as it was scored
const legacy = { mode: "practice", laserDuck: false, weaponPref: { mortar: 1.2 } }
const old = { ...legacy, rangeGun: 75, dropMaxDist: 220 } // the 4.44 behaviour, relative to today's defaults
/** Real practice scores (docs/bot.md, Submissions) and the parameters that reproduce each version. */
export const VERSIONS: { commit: string; real: number; params: Record<string, unknown> }[] = [
  { commit: "65ce172", real: 4.44, params: old },
  { commit: "6df0e10", real: 3.98, params: { ...old, rangeGun: 170, rangeLaser: 210, weaponPref: { laser: 3, gun: 2, lightning: 1.3, mortar: 1 }, idleRegen: true, avoidLightning: true, retreatPerExtra: 0.3, outnumbered: 2 } },
  { commit: "029df2d", real: 4.0, params: { ...old, idleRegen: true, treeCover: true } },
  { commit: "f4f93f8", real: 4.31, params: { ...old, reengageHp: 0.65, farmHp: 0.85 } },
  { commit: "926e5b7", real: 4.4, params: { ...old, reengageHp: 0.65 } },
  { commit: "aeb2484", real: 4.35, params: { ...old, crateRange: 140, cubeRange: 140 } },
  { commit: "7a3a25a", real: 4.46, params: { ...legacy, rangeGun: 75 } },
  { commit: "944ca5c", real: 4.38, params: { ...legacy, rangeGun: 75, dropSlack: 30 } },
]

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(name)
  return i >= 0 ? +process.argv[i + 1] : def
}

const matches = arg("--matches", 960), workers = arg("--workers", 8)
const oi = process.argv.indexOf("--only")
const only = oi >= 0 ? process.argv[oi + 1].split(",") : null
const rows: { commit: string; real: number; sim: number; ci: number }[] = []
for (const v of VERSIONS.filter((v) => !only || only.includes(v.commit))) {
  const out = execFileSync("node", [ROOT + "tools/run.ts", "--matches", String(matches), "--workers", String(workers)], {
    env: { ...process.env, MECH_PARAMS: JSON.stringify(v.params) },
    encoding: "utf8",
    maxBuffer: 64 << 20,
  })
  const m = /mean points ([\d.]+) ± ([\d.]+)/.exec(out)
  rows.push({ commit: v.commit, real: v.real, sim: m ? +m[1] : NaN, ci: m ? +m[2] : NaN })
  console.log(`${v.commit} real ${v.real.toFixed(2)} sim ${rows.at(-1)!.sim.toFixed(2)} ± ${rows.at(-1)!.ci.toFixed(2)}`)
}
// rank agreement (Spearman) between real and sim
const rank = (xs: number[]) => xs.map((x) => xs.filter((y) => y < x).length + (xs.filter((y) => y === x).length - 1) / 2)
const rr = rank(rows.map((r) => r.real)), rs = rank(rows.map((r) => r.sim))
const n = rows.length, mean = (n - 1) / 2
const cov = rr.reduce((a, x, i) => a + (x - mean) * (rs[i] - mean), 0)
const sd = (r: number[]) => Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0))
console.log(`Spearman rank correlation real vs sim: ${(cov / (sd(rr) * sd(rs))).toFixed(2)} over ${n} versions, ${matches} matches each`)
