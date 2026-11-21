# Practice score patterns (2026-11-20)

Evidence for picking the next candidate. Submission and keep rules live in [CLAUDE.md](CLAUDE.md), not here. Sim numbers below come from `node tools/run.ts` or a mode-counting probe on the same seeds (1000–1095). They describe mechanisms only and never rank changes.

## Scored submissions

Behaviour column from `git diff <4.44 bot> <commit> -- bot/` (`65ce172` or `ecbee26`); flags added but off are omitted. Place-points = score × 48, the total of 16 − place; each score maps to exactly one integer (inference: assumes 48 matches, rounded to 0.01).

| Commit | Behaviour vs the 4.44 bot | Score | Delta | Place-points |
| --- | --- | --- | --- | --- |
| `65ce172` | reference | 4.44 | 0 | 213 |
| `6df0e10` | gun 170 m, laser 210 m, loadout gun 2 / lightning 1.3 / mortar 1, `idleRegen` on, `avoidLightning` on, `retreatPerExtra` 0.3, `outnumbered` 2 | 3.98 | −0.46 | 191 |
| `ecbee26` | none (replay) | 4.44 | 0.00 | 213 |
| `096c710` (bot `029df2d`) | `idleRegen` on, `treeCover` on | 4.00 | −0.44 | 192 |
| `f4f93f8` | `reengageHp` 0.65, `farmHp` 0.85 | 4.31 | −0.13 | 207 |
| `926e5b7` | `reengageHp` 0.65 | 4.40 | −0.04 | 211 |
| `aeb2484` | `crateRange`, `cubeRange` 90 → 140 m | 4.35 | −0.09 | 209 |
| `7a3a25a` | `dropMaxDist` 220 → 300 m | **4.46** | +0.02 | 214 |
| HEAD | `7a3a25a` plus `dropSlack` 6 → 30 s | pending | | |

## Patterns

1. **Both big losses had `idleRegen` on, so "long range lost" is confounded.** `6df0e10` stacked seven changes, not two (the `docs/bot.md` Submissions table listed only range and loadout until this file). The one change shared by the two −0.45 results is `idleRegen`: the bot enters `regen` whenever nothing is in view and HP is under `reengageHp` (`bot/brain/brain.ts:268`), stands still, and ignores a visible hunter until hit (`brain.ts:259`). Regen runs whether we move or not (`protocol.md` §7 Health), so standing still buys only silence (§8 Sound) and costs roaming time.
   **Evidence:** the diffs in the table. Sim probe, mechanism only: `idleRegen` alone moves decisions in `regen` from 8.1% to 17.9% and cubes per match from 3.67 to 3.34.
   **Confidence:** moderate that more standing still costs about 0.45 (two results agree); low on which part of each stack did it. Long range alone has never been scored.

2. **Points count the house bots that die before us.** Place is the number alive when we die (§6 `alive`, §4), so points = mechs dead strictly before us. House bots never fight each other (track page, quoted at `sim/house.ts:2-4`), so they die only to us, the zone (§9), NPC drones (which shoot attackers and mechs within 45 m in sight, §7 NPC drones), or their own mortar splash (§7 Weapons). Each kill also brings more hunters (`sim/house.ts:3-4`, counts guessed). So kills bank points, and survival time pays only through later kills or other house deaths. (inference)
   Clock-out ranking by HP (§4) cannot happen under the kit config: the last circle reaches radius 0 at 415 s at 260 HP/s, matches last 480 s, and max HP is about 1400 × 1.4 × 1.15³ ≈ 2981 (10 cubes, 3 plating). A late game ends in zone deaths ordered mostly by HP, which armor and regen cannot protect (§7 Health). (inference)
   **Evidence:** `zone.phases` and `match.duration_s` in `mechfight-kit/check/stream.jsonl.gz`. The real mix of deaths is unknown: no replays or match data exist (`CLAUDE2.md` Observations) and match stderr is hidden (§3). Sim probe, mechanism only: of 3.4 points per match, 2.9 are our kills, 0.45 drones, 0 zone.
   **Confidence:** high on the arithmetic; low on the real split between kills, zone and drones.

3. **Effect sizes: small deltas are within re-roll noise.** Smallest delta −0.04 (2 place-points), largest −0.46 (22). One place in one match is 0.021, so 0.05 is about 2.4 places over 48 matches. The leaderboard top, 5.23 (`CLAUDE2.md` Observations), is 0.79 (38 places) ahead. Deterministic scoring means a score repeats, not that a small delta is the tactic's effect: any behaviour change shifts trajectories and re-rolls some matches. (inference)
   **Evidence:** 4.44 params, same 48 seeds, only `--workers` changed (8 layouts): means 3.33 to 3.77 (sd 0.15); workers 1 and 11 differ in 12 of 48 placements; seed 1013 places 12 alone, 9 in the 11-worker batch. Likely cause: the wall-clock A* gate at `brain.ts:606` (unconfirmed).
   **Confidence:** high on the arithmetic; moderate that real deltas under about 0.2 (`reengageHp` −0.04, `farmHp` about −0.09) are noise.

4. **"Farming less hurt" is weak.** The −0.09 credited to `farmHp` 0.85 (`docs/bot.md` Decisions, `CLAUDE2.md` Observations) is 4.31 − 4.40. That assumes the two changes add, and it amounts to 4 places, inside the noise of pattern 3.
   **Evidence:** `farmHp` gates drones and crates (`brain.ts:465`, `brain.ts:481`). Sim probe, mechanism only: the pair loses no cubes (3.70, against 3.51 for `reengageHp` alone).
   **Confidence:** low.

5. **The sim got the one large change backwards and cannot resolve the small ones.**
   **Evidence:** it predicted 2.92 for the 4.44 bot and 7.63 for `6df0e10` (real 3.98) (`docs/bot.md` Submissions). Re-run today on the same seeds, it still puts the `6df0e10` stack 1.3 to 2.1 points above the 4.44 behaviour, and the three smaller losers land above or below it depending on how the run is split across workers. One identified bias: sim house guns fire only within 120–200 m by tier (`sim/house.ts:30`, `:132`), short of the gun's 230 m range (§7 Weapons), so at 170 m most sim hunters cannot answer. Nothing shows the real house bots have that limit. For `aeb2484` the sim shows only that cubes rise (`docs/bot.md` Measurements).
   **Confidence:** high that sim points cannot rank changes of this size.

## Next candidates

Stacked scores cannot be split (`CLAUDE2.md` Observations, pattern 4). The first clean test of farming more, `aeb2484` (crates and cubes to 140 m), scored 4.35 (−0.09). Every change so far has lost: 6 of 6. Under symmetric noise that would happen 1 time in 64, so the losses are probably real, not just re-rolls. (inference)

- **Promising, low to moderate confidence: more cubes without standing still.** A cube adds 4% max HP and damage and heals the HP it adds (§10), and HP decides a late game (pattern 2). Untested ideas:
  - Dropped 2026-11-20 after `aeb2484` lost: `farmHp` 0.6 → 0.4 (`bot/params.ts:41`), more farming. A drone hits for 25 once per second (`config.npc`) and drops 2 cubes; crates never shoot. Risk: drones also kill house bots for us (0.45 per match in the sim, mechanism only).
  - `fightCubeRange` 30 → 45 m (`params.ts:35`). A killed mech drops all its cubes plus two (§10).
  - Scored 4.46 as submission 8, the first gain (+1 place-point), kept: `dropMaxDist` 220 → 300 m (`params.ts:53`). A drop gives 3 cubes, full HP and energy, and lands 25 s after the call (§7 Supply drops); 300 m at 11.7 m/s is 26 s, inside the ETA rule at `brain.ts:505`.
  - Testing as submission 9: `dropSlack` 6 → 30 s (`params.ts:52`). Drops stay listed until captured (`protocol.md` §5 `drops`), but once one has landed `lands_in` is 0, so the 6 s slack chased landed drops only within about 70 m.
- **Avoid, moderate confidence:** more standing still or hiding (`idleRegen`, `treeCover`, earlier retreat). Pattern 1.
- **Avoid, moderate confidence:** tweaks expected to move only a few places; they cannot be told from re-roll noise (pattern 3).
- **Open, low confidence:** long range alone (`rangeGun` 170 m) was never scored. Its only sim support is the bias in pattern 5, so it ranks below the cube ideas.
- **Keep:** plating first (`params.ts:12`), since HP decides zone deaths (pattern 2).
