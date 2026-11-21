/**
 * Every tunable number of the bot. The simulator may override any of them for A/B runs by setting
 * MECH_PARAMS to a JSON object (merged one level deep); the Docker image never sets it.
 */
export const P = {
  /** Value of each weapon kind in a loadout. Higher is kept; lower is swapped out. */
  weaponPref: { laser: 3, lightning: 2.6, gun: 1.6, mortar: 1.2 } as Record<string, number>,
  /** Minimum loadout gain to walk to a pickup / swap a held weapon. */
  swapGain: 0.4,
  /** Upgrade ids in the order we prefer them; unknown ids rank last. */
  upgradeOrder: [
    "plating", "armor", "nanites", "laser_damage", "lightning_efficiency", "gun_damage", "laser_charge",
    "gun_rate", "lightning_range", "gyros", "lightning_chain", "gun_velocity", "gun_mag", "mortar_reload",
    "servos", "capacitor", "reactor", "jets", "sensors", "laser_pierce", "mortar_splash", "mortar_velocity",
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
  /** Engagement range keeping by main weapon (meters). */
  rangeGun: 75,
  rangeLaser: 120,
  rangeLightning: 28,
  rangeMortar: 110,
  /** Supply drops: go when nothing hostile is in sight and our ETA is within this many seconds of landing. */
  dropSlack: 30,
  dropMaxDist: 300,
  /** A* budget: at most one search per decision, only if less than this many ms were used, at most this many cells. */
  pathBudgetMs: 12,
  pathExpand: 25000,
  /** A walkable region smaller than this many 2 m cells is a pocket: jet out of it toward the goal. */
  pocketCells: 3000,
  /** Boost when the goal is farther than this and energy is above `boostOn` (stop below `boostOff`). */
  boostDist: 50,
  boostOn: 55,
  boostOff: 25,
}

export type Params = typeof P

export function loadParams(env: string | undefined): Params {
  if (!env) return P
  try {
    const o = JSON.parse(env)
    for (const k of Object.keys(o)) {
      const cur = (P as any)[k]
      ;(P as any)[k] = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur, ...o[k] } : o[k]
    }
  } catch (e) {
    console.error("bad MECH_PARAMS", e)
  }
  return P
}
