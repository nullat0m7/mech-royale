# Handoff

Rules live in `CLAUDE.md` and override this file. Design, decisions and the submissions log are in `docs/bot.md`; the change history is in `CHANGELOG.md`.

## 0. Built, with evidence

- **Repo setup**, 2026-11-20, `64d0b01`: TypeScript bot on Node 24 with no runtime dependencies; `Dockerfile` (node:24.22.3-slim pinned by digest, copies `package.json` and `bot/` only); `.gitignore`, `.dockerignore`; vendored kit in `mechfight-kit/`; scripts in `package.json` (`node --run typecheck|test|check|docker:build|check:docker|verify|sim`).
- **Bot**, 2026-11-20, `bot/main.ts` → `bot/brain/brain.ts` (`Brain.act`):
  - World: `bot/world/map.ts` (`World.rayHit`, `clear`, `sightClear`, `treesBlock`) and `bot/world/nav.ts` (`Nav.path`, `reachable`, `snap`, regions).
  - Every tunable number is in `bot/params.ts` (`P`).
  - Verified at submission 6 (`farmHp` 0.85): type check 0 errors, `node --run test` 10/10 (includes a 10 000-observation fuzz test), local check PASS 300/300 (p99 0.6 ms), Docker sandbox check PASS 300/300 (p99 4.3 ms, max 9.8 ms).
- **Simulator**, 2026-11-20:
  - `sim/engine.ts` (`Sim`), `sim/house.ts` (`houseController`, `ffaController`, `exampleFactory`, `HOUSE` with a `HOUSE_PARAMS` env override), `tools/run.ts` (batch runner), `tools/viewer.html` (replay viewer).
  - About 1.5 s per match.
  - It mis-ranks tactics: see the `CLAUDE.md` Observations.
- **Practice scores (exact; the scorer is deterministic):**

  | Commit | Score | Notes |
  | --- | --- | --- |
  | `65ce172` | 4.44 | |
  | `6df0e10` | 3.98 | long range, reverted |
  | `ecbee26` | 4.44 | |
  | `096c710` (bot = `029df2d`) | 4.00 | submission 4: `treeCover` and `idleRegen` on; turned off again |
| `fe134fc` | pending | submission 5: 4.44 behaviour plus `reengageHp` 0.65 |
| HEAD of `main` | pending | submission 6: submission 5 plus `farmHp` 0.85 |

## 1. Next

The owner will paste practice scores for submission 5 (`fe134fc`, `reengageHp` 0.65) and submission 6 (HEAD, plus `farmHp` 0.85). Compare 5 against 4.44 and 6 against 5. Revert a change whose score did not beat the one before it. If submission 5 was never scored on its own, HEAD carries both changes and its score is for the pair.

Each submission must carry one new candidate improvement. Untried candidates, reasoned in `docs/bot.md` Decisions: `farmUntil` later (more cubes), `upgradeOrder` with weapon damage earlier, shorter gun range. Rejected with reasons there: armor before plating, longer gun range, skipping drops.
