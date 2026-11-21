/** mech-royale bot entry: builds the world model at `hello`, then runs the brain once per observation. */
import { type Action, type Hello, type Observation, log, run } from "./mechfight.ts"
import { Brain, zoneAt } from "./brain/brain.ts"
import { loadParams } from "./params.ts"
import { World } from "./world/map.ts"
import { Nav } from "./world/nav.ts"

/** Last-resort action when the brain throws: walk to the zone centre, keep aim, don't fire. */
export function fallback(obs: Observation): Omit<Action, "tick"> {
  const z = zoneAt(obs.zone, obs.t)
  const dx = obs.zone.next_center[0] - obs.self.pos[0], dy = obs.zone.next_center[1] - obs.self.pos[1]
  const d = Math.hypot(dx, dy)
  const inside = Math.hypot(z.x - obs.self.pos[0], z.y - obs.self.pos[1]) < z.r * 0.8
  return { move: d < 5 || inside ? [0, 0] : [dx / d, dy / d], aim: obs.self.aim, boost: !obs.self.in_zone }
}

/** `overrides` lets the simulator run differently tuned copies of the bot in one process (league). */
export function makeBot(hello: Hello, overrides?: Record<string, unknown>) {
  const P = loadParams(process.env.MECH_PARAMS, overrides)
  let brain: Brain | null = null
  try {
    const t0 = performance.now()
    const world = World.load(hello.map.dir)
    const nav = new Nav(world, hello.config.mech.step_up, hello.config.mech.max_slope_deg, hello.config.mech.height)
    brain = new Brain(hello, world, nav, P)
    log(`world ready in ${(performance.now() - t0).toFixed(0)} ms`)
  } catch (e) {
    log("world load failed, running fallback only:", e)
  }
  let errors = 0
  return {
    name: "mech-royale",
    brain,
    act(obs: Observation) {
      if (!brain) return fallback(obs)
      try {
        return brain.act(obs)
      } catch (e) {
        if (++errors <= 5 || errors % 100 === 0) log(`brain failed at tick ${obs.tick} (${errors}):`, e)
        return fallback(obs)
      }
    },
  }
}

if (process.argv[1]?.endsWith("main.ts")) run((h) => makeBot(h))
