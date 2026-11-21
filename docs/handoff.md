# Handoff

Rules live in `CLAUDE.md` and override this file. Design, decisions and the submissions log are in `docs/bot.md`; the change history is in `CHANGELOG.md`.

## 0. Built, with evidence

- **Repo setup**, 2026-11-20, `64d0b01`: TypeScript bot on Node 24 with no runtime dependencies; `Dockerfile` (node:24.22.3-slim pinned by digest, copies `package.json` and `bot/` only); `.gitignore`, `.dockerignore`; vendored kit in `mechfight-kit/`; scripts in `package.json` (`node --run typecheck|test|check|docker:build|check:docker|verify|sim`).
- **Bot**, 2026-11-20, `bot/main.ts` → `bot/brain/brain.ts` (`Brain.act`):
  - World: `bot/world/map.ts` (`World.rayHit`, `clear`, `sightClear`, `treesBlock`) and `bot/world/nav.ts` (`Nav.path`, `reachable`, `snap`, regions).
  - Every tunable number is in `bot/params.ts` (`P`).
  - Verified at submission 7 (crates and cubes to 140 m): type check 0 errors, `node --run test` 10/10 (includes a 10 000-observation fuzz test), local check PASS 300/300 (p99 0.8 ms), Docker sandbox check PASS 300/300 (p99 5.2 ms, max 27.9 ms).
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
| `fe134fc` | not scored | `reengageHp` 0.65 alone |
| `f4f93f8` | 4.31 | submission 5: `reengageHp` 0.65 + `farmHp` 0.85 |
| `926e5b7` | 4.40 | submission 6: `reengageHp` 0.65 alone; back to 0.85 |
| HEAD of `main` | pending | submission 7: 4.44 behaviour plus `crateRange` and `cubeRange` 140 m |

## 1. Next

The owner will paste the practice score for submission 7 (HEAD, `crateRange` and `cubeRange` 140 m). If it is above 4.44, keep it. If it is 4.44 or below, set both back to 90, which restores the 4.44 behaviour, and try the next candidate.

Each submission must carry one new candidate improvement. Untried candidates, reasoned in `docs/bot.md` Decisions: `farmUntil` later (more cubes), `npcRange` or a lower `farmHp` (more farming, the direction the 4.31/4.40 pair favours), `upgradeOrder` with weapon damage earlier, shorter gun range. Rejected with reasons there: armor before plating, longer gun range, skipping drops, `farmHp` 0.85 (about −0.09), `reengageHp` 0.65 (4.40).
