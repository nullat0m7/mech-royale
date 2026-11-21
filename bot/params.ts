/**
 * Every tunable number of the bot. The simulator may override any of them for A/B runs by setting
 * MECH_PARAMS to a JSON object (merged one level deep), or per bot through `loadParams(env, extra)`;
 * the Docker image never sets either.
 */
export const P = {
  /** "auto" detects a free-for-all from deaths we did not cause; "practice" / "ffa" force a mode (tests, league). */
  mode: "auto" as "auto" | "practice" | "ffa",
  /**
   * Value of each weapon kind in a loadout. Higher is kept; lower is swapped out. Below 0: never take it, and drop
   * it if held. A held mortar makes every laser hit on us cook off for +60% (protocol.md section 7), and house bots
   * carry lasers (the real recording in mechfight-kit/check landed 4 of 4 full-charge lasers at 57-150 m).
   */
  weaponPref: { laser: 3, lightning: 2.6, gun: 1.6, mortar: -1 } as Record<string, number>,
  /**
   * Laser duck: when a visible mech is charging a laser aimed at us, step to the nearest spot within `duckR` m that
   * it cannot see. A held full charge fires on its own after hold_s (protocol.md section 7), so it may go into a wall.
   */
  laserDuck: true,
  duckR: 14,
  /** Minimum loadout gain to walk to a pickup / swap a held weapon. */
  swapGain: 0.4,
  /** Upgrade ids in the order we prefer them; unknown ids rank last. */
  upgradeOrder: [
    "plating", "armor", "nanites", "laser_damage", "lightning_efficiency", "gun_damage", "laser_charge",
    "gun_rate", "lightning_range", "gyros", "lightning_chain", "gun_velocity", "gun_mag", "mortar_reload",
    "servos", "capacitor", "reactor", "jets", "sensors", "laser_pierce", "mortar_splash", "mortar_velocity",
  ],
  /**
   * Free-for-all ("ghost") mode, for the qualifying round and final (16-mech free-for-alls between entries).
   * Detected when at least `ffaDeaths` mechs we did not kill are dead by `ffaDetectT` s: house bots never fight each
   * other, so in practice only we kill them that early (PATTERNS.md pattern 2).
   */
  ffaDetectT: 150,
  ffaDeaths: 2,
  /** Ghost: move quietly (below the 5 m/s step speed) with a mech within this range or heard near/mid in the last 3 s. */
  ghostQuietR: 60,
  ghostQuietMove: 0.4,
  /** Ghost: hit by a mech within this many s counts as attacked; break line of sight if cover is this close, else fight. */
  ghostAttackedS: 2,
  ghostCoverDist: 25,
  /** Ghost: finish a visible enemy at or below this HP fraction when we have this much and no other mech is this close. */
  ghostFinishHp: 0.35,
  ghostFinishSelfHp: 0.5,
  ghostFinishClear: 150,
  /** Ghost: loot, cube, crate and drop ranges, and how far other mechs must be from a drop. */
  ghostCubeR: 40,
  ghostLootR: 40,
  ghostCrateR: 60,
  ghostDropR: 120,
  ghostDropClear: 150,
  /** Ghost ends (full combat) at this many alive, this next-circle radius, or this match time. */
  ghostEndAlive: 4,
  ghostEndRadius: 70,
  ghostEndT: 330,
  /** Upgrade order in a free-for-all: the endgame is an HP race in the closing zone (protocol.md sections 9-10). */
  ghostUpgradeOrder: [
    "plating", "armor", "nanites", "sensors", "laser_damage", "lightning_efficiency", "gun_damage", "laser_charge",
    "gun_rate", "lightning_range", "gyros", "lightning_chain", "gun_velocity", "gun_mag", "servos", "capacitor",
    "reactor", "jets", "mortar_reload", "laser_pierce", "mortar_splash", "mortar_velocity",
  ],
  /** Retreat to cover below this HP fraction; fight again above reengage. */
  retreatHp: 0.4,
  reengageHp: 0.85,
  /** Hide and regenerate below reengageHp whenever nothing is in view (not only after a retreat). */
  idleRegen: false,
  /** Count spots hidden from a threat only by trees as partly covered (this fraction of fully exposed). */
  treeCover: false,
  treeCoverCost: 0.4,
  /** Keep at least 60 m from a target carrying lightning when we have a gun or laser. */
  avoidLightning: false,
  /** Each extra hostile with a line of fire on us adds this to the retreat threshold. */
  retreatPerExtra: 0.15,
  /** With this many hostile mechs tracked, fight only above `outnumberedHp`. */
  outnumbered: 3,
  outnumberedHp: 0.75,
  /** Target choice: weight of target HP (per point) and bonus (meters) for staying on the current target. */
  targetHpWeight: 0.15,
  targetStick: 60,
  /** Walk onto cubes this close even mid-fight. */
  fightCubeRange: 30,
  /** Zone: target a point within this fraction of the next radius; travel safety factor and slack. */
  zoneFrac: 0.7,
  zoneSlack: 8,
  /** Farm NPC drones and crates until this match time, above this HP fraction. */
  farmUntil: 330,
  farmHp: 0.6,
  npcRange: 170,
  crateRange: 90,
  lootRange: 170,
  cubeRange: 90,
  /**
   * Strafing in a fight: every `strafeMin` + U(0, `strafeSpan`) s, reverse with probability `strafeFlip`. Bullets take
   * 0.4-0.9 s to cross 100-230 m (protocol.md section 7), so frequent reversals make a shooter who leads our velocity miss.
   */
  strafeMin: 0.6,
  strafeSpan: 1.2,
  strafeFlip: 0.5,
  /** Engagement range keeping by main weapon (meters). */
  rangeGun: 100,
  rangeLaser: 120,
  rangeLightning: 28,
  rangeMortar: 110,
  /** Supply drops: go when nothing hostile is in sight and our ETA is within this many seconds of landing. */
  dropSlack: 6,
  dropMaxDist: 300,
  /**
   * A* budget: at most one search per decision, at most this many cells. `brakeMs` is an emergency stop only:
   * past it, optional searches reuse their last answer. It is far above normal decision times so that runs stay
   * deterministic (the same seeds give the same match whatever the machine load).
   */
  brakeMs: 30,
  pathExpand: 25000,
  /** A walkable region smaller than this many 2 m cells is a pocket: jet out of it toward the goal. */
  pocketCells: 3000,
  /** Boost when the goal is farther than this and energy is above `boostOn` (stop below `boostOff`). */
  boostDist: 50,
  boostOn: 55,
  boostOff: 25,
}

export type Params = typeof P

/** Merge `o` into `into`, one level deep (nested plain objects such as `weaponPref` are merged, arrays replaced). */
function merge(into: Params, o: Record<string, unknown>) {
  for (const k of Object.keys(o)) {
    const cur = (into as any)[k]
    ;(into as any)[k] = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur, ...(o[k] as object) } : o[k]
  }
}

/** A fresh copy of the defaults with MECH_PARAMS (JSON text) and then `extra` merged in. Never mutates `P`. */
export function loadParams(env: string | undefined, extra?: Record<string, unknown>): Params {
  const out = structuredClone(P)
  if (env) {
    try {
      merge(out, JSON.parse(env))
    } catch (e) {
      console.error("bad MECH_PARAMS", e)
    }
  }
  if (extra) merge(out, extra)
  return out
}
