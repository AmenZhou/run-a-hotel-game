# Changelog

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
