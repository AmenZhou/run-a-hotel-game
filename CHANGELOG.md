# Changelog

## [0.3.6] - 2026-05-25
### Fixed
- **Lower floors hard to click with 3+ guest levels** — stacked iso diamonds used to always pick the top floor; hover/click now choose the tile whose center is closest to the cursor, with ties favoring the **lower** floor so mid-levels stay reachable

### Added
- **Overlook rotation** — `state.isoYaw` with ⟲ / ⟳ controls (10° per click) around the same pivot as pan/zoom; persists in save/load; reset view clears rotation
- **Inverse-rotate hit testing** — mouse picking matches the rotated canvas

## [0.3.5] - 2026-05-25
### Changed
- **Starting budget** — new games and `startNewGame()` now begin with **$10,000** cash (was $5,000); defined as `STARTING_CASH` in `js/game-state.js`

### Documentation
- `ai-agent/README.md` — sample console output updated for $10k start and zero starter staff

## [0.3.4] - 2026-05-25
### Notes — game balance & design (from agent / JSONL log review)

These are **not shipped changes**; they capture follow-up ideas surfaced while stress-testing the sim.

- **Rent timing** — Cash arrives mainly on **guest checkout**, while `estRentPerSec` is a smoothed estimate. Early game can feel cash-poor until checkouts land. Possible follow-ups: small per-tick rent, shorter average stay, or UI copy that makes “payday at checkout” obvious.
- **Early expansion** — Multiple back-to-back **builds** (~$4.5k+) before income ramps can bankrupt a greedy strategy (human or AI). Possible follow-ups: tune `buildRoomCost`, starting materials, or first-room rent for a gentler ramp.
- **Materials bottleneck** — **Concrete** hitting zero hard-stops construction until the market or buys refill. Possible follow-ups: higher starting concrete, cheaper first-floor builds, or clearer affordance for buying materials when broke.
- **Agent vs game** — Aligning **affordability** with the real UI (disabled build button) and logging **no-op** actions improved log fidelity; the game itself benefits when telemetry matches player-visible rules.

## [0.3.3] - 2026-05-25
### Fixed
- **Agent premature housekeeper hire** — `canHireHousekeeper` requires at least one dirty room; blocks LLM hires when `dirty === 0`

## [0.3.2] - 2026-05-25
### Changed
- **No starter staff** — new games and fresh loads start with 0 employees; hire from Management when ready (passive room cleaning still applies)
- **Agent auto new game** — each agent run calls `startNewGame()` on launch (skip with `--continue-save`); exposed as `window.startNewGame()` for automation

## [0.3.1] - 2026-05-25
### Fixed
- **Agent build no-ops** — `canBuildRoom` now mirrors the UI build button (capacity, placement, materials); ineffective `build_room`/`upgrade_room` calls are logged as `blocked_action` with reason `no_effect`
- **Agent housekeeper spam** — hard cap of 1 housekeeper per 3 dirty rooms in affordability + pre-LLM auto-fire when over cap
- **Mass bankruptcy layoffs** — payroll shortfall dismisses one staff member per tick (highest wage first) instead of firing the entire workforce at once
- **Slow recovery without staff** — passive dirty-room cleaning rate increased (1.5%/game-sec at 1× speed)

## [0.3.0] - 2026-05-25
### Added
- **New Game button** — red 🔄 button in the top bar resets all state and starts fresh (with confirmation dialog)
- **Bankruptcy mechanic** — when cash cannot cover the next wage tick, all staff are immediately dismissed and their walkers removed; player must re-hire from the Management tab once funds are restored
- **Low-cash warning** — toast fires when < 10 seconds of wages remain, giving advance notice before staff are dismissed
- **Booking debug logging** — `[booking]` console logs added to `triggerGuestBooking()` to aid diagnosis

### Fixed
- **Guests not booking floor 1 rooms** — `spawnDefaultReceptionist()` was not incrementing `state.staff.receptionist`, so the 20% booking bonus was never applied; fixed by adding `state.staff.receptionist++`
- **Dirty rooms blocking bookings** — added a default starter housekeeper (same pattern as receptionist) so rooms are cleaned automatically from game start; saves with no housekeeper also get one on load
- **Negative cash** — wage deduction now uses `Math.max(0, cash - wages)` so cash never goes below $0
- **Build Room could overspend** — added a server-side resource guard in the build handler so it cannot deduct cash/materials even if the disabled button state is bypassed
- **Elevator cabin appears inside room** — elevator cabin (cyan circle) was drawn on top of guest rooms at grid position (R=0, C=1); cabin is now hidden when it overlaps a floor with a guest room at the elevator shaft column
- **Rooms built on elevator shaft** — the build handler now skips `(ELEVATOR_R, ELEVATOR_C)` when searching for the next empty cell, preventing rooms from being placed on the elevator shaft

## [0.2.0] - 2026-05-25
### Added
- Claude Haiku-powered AI agent (`ai-agent/`) that plays the game autonomously via Playwright — reads game state every 4 seconds and executes one action per tick
- First-person 3D room view (`js/room3d.js`)
- `.gitignore` to exclude `.env` and `node_modules`

### Changed
- `js/renderer.js` — updated to support 3D room integration
- `js/ui.js` — UI updates for room3d view
- `grand_hotel_blueprint.html` — wired up room3d entry point

## [0.1.0] - 2026-05-25
### Added
- Initial game: hotel management sim with isometric renderer
- `grand_hotel_blueprint.html` — main entry point
- `js/game-state.js` — game state, constants, walker logic, audio engine
- `js/renderer.js` — isometric canvas renderer
- `js/ui.js` — UI controls, build/upgrade/staff events
