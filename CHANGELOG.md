# Changelog

## [0.3.28] - 2026-05-26
### Fixed
- **`C is not defined` crash in tick handler** (`ai-agent/agent.js`) — `window.CONSTANTS` was scoped inside `readState()` but referenced at lines 661/673 in `tick()` for chef/valet stack overrides; crashed 80% of ticks (32/40), silencing the LLM completely after T6; fix: read `C` at the top of `tick()`

## [0.3.27] - 2026-05-26
### Fixed
- **Booking probability cap** (`js/simulation.js`) — clamp `finalChance` to 0.95 max; prevents 3-receptionist + campaign from always booking (chance was hitting 1.22), making campaigns and rush hour actually matter
- **Builder is now essential** (`js/ui.js`) — passive construction rate reduced from 3%/s to 0.5%/s at 1× speed; rooms now take ~50s solo vs ~19s with builder, giving the $75 hire a clear payoff
- **Builder auto-hire override** (`ai-agent/agent.js`) — agent automatically hires a builder whenever rooms are under construction and no builder is present; fires before LLM turn

## [0.3.26] - 2026-05-26
### Agent (`ai-agent/agent.js`)
- **Housekeeper backlog override** — auto-hire fires whenever dirty ≥ 2 and under cap (was only when hk=0); prevents hotel jamming up with 5+ dirty rooms and no rebook
### Game (`js/ui.js`)
- **Owner WASD movement (inside view)** — WASD / arrow keys move the owner character one cell at a time in Inside view; `[`/`]` change floors; input ignores if a text field is focused

## [0.3.25] - 2026-05-26
### Balance
- **Restaurant cost reduced** — $800 cash + 10 wood + 15 concrete + 4 steel (was $2200 + 22 wood + 30 concrete + 8 steel); now affordable immediately from starting cash
- **Parking cost reduced** — $600 cash + 20 concrete + 6 steel (was $1800 + 40 concrete + 12 steel)
- **Restaurant income raised** — $1.50/s (was $0.80/s); ROI now clearly beats a Level-1 room at 4× speed
- **Parking income raised** — $1.00/s (was $0.50/s)
- **Upgrade room cost reduced** — $500 cash (was $800); 12 wood + 6 steel unchanged
### Agent (`ai-agent/agent.js`)
- **Pre-LLM override: auto-build restaurant** — fires immediately when affordable (1+ rooms); restaurant built turn 1 from starting cash + materials
- **Pre-LLM override: auto-hire chef** — fires immediately when restaurant is ready and no chef on staff
- **Pre-LLM override: auto-build parking** — fires when restaurant exists and parking affordable
- **Pre-LLM override: auto-hire valet** — fires immediately when parking is ready and no valet on staff
- **One-of-each cap** — `canBuildRestaurant` / `canBuildParking` blocked when one already exists; prevents duplicate amenity builds
- **facilityNote in LLM prompt** — injects "restaurant already built — do NOT build another" when facility exists, stops LLM from wasting turns trying to build duplicates
- **Strategy rules 9–11 updated** — new costs, new income rates, one-each cap, ROI comparison against rooms
- **Upgrade cost reference updated** in system prompt ($500)

## [0.3.24] - 2026-05-26
### Agent (`ai-agent/agent.js`)
- **Strategy rewrite** — replaced 8 heuristic rules with tighter caps and materials-first logic:
  - Rule 1–2: materials-first buying; standing stockpile ≥ 20 wood / ≥ 30 concrete regardless of price
  - Rule 3: housekeeper discipline — never fire-then-rehire; only fire if dirty=0 for 2+ turns
  - Rule 4: receptionist cap — 1 per 2 ready rooms, max 3
  - Rule 5: builder cap — 1 per building room, max 2; fire ALL when building=0
  - Rule 6: upgrades only after materials stocked (wood ≥ 15, concrete ≥ 25)
- **`materialShortfall` in readState** — exposes exact wood/concrete/steel gaps for next room, restaurant, and parking builds so agent can directly buy what is missing
- **Affordability guards tightened** — `canHireBuilder` blocked when no rooms are building or at cap (max 2); `canHireReceptionist` blocked at cap (1 per 2 ready rooms, max 3); `canFireBuilder` only offered when no building rooms; `canFireReceptionist` only offered when over cap
- **`fire_staff (chef/valet)` in valid actions** — was missing from `validActionsThisTurn`; now included when canFireChef/canFireValet

## [0.3.23] - 2026-05-26
### Changed
- **Restaurant income raised** — base $0.80/s (was $0.30/s); half-rate ($0.40/s) when no Chef is on staff, full rate requires ≥1 Chef; up to 3 Chefs add +25% each (max +75%).
- **Parking income raised** — base $0.50/s (was $0.20/s); half-rate ($0.25/s) without a Valet; same 3-valet cap/multiplier.
- **`CONSTANTS.facilityUnstaffedFactor`** — new constant (0.5) controls the unstaffed income penalty; first-earn toasts now mention the reduced rate and suggest hiring staff.
- **Ledger "Amenity Income" row** — Management tab Operating Statement now shows facility passive $/s separately (🍽 🅿️ line above Net Flow).
- **Build card descriptions** — Restaurant and Parking lot cards now show exact income rates and staff requirements.
### Fixed
- **Save/load room cap** — `loadGame` now enforces `maxRooms ≥ 100` and `maxFloors ≥ 20` so old saves cannot revert to smaller limits.
### Agent (`ai-agent/agent.js`)
- **Chef & Valet in system prompt** — staff table, hire_staff params, and Notes section updated.
- **Restaurant/parking strategy rules** — three new numbered priorities (9–11) with ROI guidance.
- **`readState` expansion** — exposes `facilityCount`, `facilityPassiveIncome`, `financials.facilityPerSec`; chef/valet added to walkerCounts.
- **Affordability guards** — `canHireChef` / `canHireValet` (require matching facility, cap at 3); `canFireChef` / `canFireValet`; clamping and valid-actions list updated.

## [0.3.22] - 2026-05-25
### Added
- **Restaurant & parking builds** — Build tab adds **Approve Restaurant Build** and **Approve Parking Lot** amenities on the same guest-floor grid as suites (next empty cell or new floor), with material costs in `CONSTANTS.buildRestaurantCost` / `buildParkingCost`. They construct like suites (`building` → `ready`), respond to **builders** and **click-to-assist**, render in **Inside / Exterior** views, are **walkable in manager mode**, and each ready facility adds a small **walk-in booking** bonus (capped) in `triggerGuestBooking`.

## [0.3.21] - 2026-05-25
### Added
- **360° isometric orbit** — In **Inside** and **Exterior** views, spin the hotel continuously: **right-drag** or **Alt+left-drag** on the canvas (same `isoYaw` as ⟲ ⟳), plus **Shift+mouse wheel** for stepped rotation. Context menu suppressed on the canvas while in those views so right-drag doesn’t open the browser menu.

## [0.3.20] - 2026-05-25
### Added
- **Hotel proprietor** — `state.hotelOwner` (`name`, `title`) persisted in **save/load**; default **Jordan Blake / Proprietor**. A small suited figure stands in the **lobby** (Inside view) with an **OWNER** identity tag; subtle idle bob. Header **Owner** chip + **Management → Proprietor** card to edit name/title and **Save proprietor profile**.

## [0.3.19] - 2026-05-25
### Added
- **Manager walk** — Fourth viewport mode (cycle the eye button after **1st Person**): first-person **locomotion** on each floor via a lightweight **raycast** (perimeter + elevator pillar). **WASD / arrows** move and turn; **E** opens a **guest suite** in the same 3D interior as classic FP; **Esc** or **← Back** exits the suite; **[** / **]** changes floors when standing near the **lift core**. The canvas uses **`tabindex="0"`** so keys work after the mode is selected (it auto-focuses).

## [0.3.17] - 2026-05-25
### Fixed
- **Multiple housekeepers targeting one dirty room** — While the first worker was in the **elevator** (`elevator_up` / `elevator_down`), their state was no longer `heading_to_clean`, so `findDirtyRoomForHousekeeper` did not treat the suite as claimed. Commitment now includes elevator legs when `_preElevatorState === 'heading_to_clean'`. The same pattern is applied to **builders** (`heading_to_build`). **Idle** staff now clear **`assignedRoom`** after finishing a job so stale references cannot confuse assignment.

## [0.3.16] - 2026-05-25
### Added
- **Stronger zoom** — `CONSTANTS.viewZoom`: range **0.28×–5.5×**, larger **+ / −** steps, **mouse wheel** on the canvas zooms in/out (Inside / Exterior views; skipped in first-person).
- **Walker identity tags** — Two-line pill above each person: **STAFF** or **GUEST**, plus role (**Housekeeper**, **Builder**, **Reception**, **Guest**, **VIP Guest**). Color-coded borders; shifts up when a mood bubble is showing; sleeping guests get a tag above the bed head.

## [0.3.15] - 2026-05-25
### Changed
- **Staff department upgrades (all jobs)** — Replaced housekeeping-only `hkTrainingLevel` / `CONSTANTS.hkTraining` with per-role **`staffTrainingLevels`** and **`CONSTANTS.staffTraining`**: **housekeeper**, **builder**, and **receptionist** each have **5** cash upgrade tiers with steeper in-game effects.
  - **Housekeeping:** cleanliness / sec × `(1 + 0.55 × level)` (was +42% per level capped at 3).
  - **Construction:** automated `buildProgress` / sec uses **`getBuilderConstructionRate()`** × `(1 + 0.48 × level)`.
  - **Reception:** walk-in booking bonus per receptionist × **`getReceptionistBookingMultiplier()`** `(1 + 0.15 × level)`.
- **Save/load** — Persists `staffTrainingLevels`; **legacy** saves still load **`hkTrainingLevel`** into housekeeping only.

## [0.3.14] - 2026-05-25
### Fixed
- **Multiple housekeepers / builders claimed the same room** — assignment scanned the grid and every idle worker grabbed the **first** matching cell. Idle workers now pick the first dirty / `building` room **not already assigned** to another worker of that type (in `heading_to_*` or active work states).

### Added
- **Housekeeping training upgrades** — global levels **0→3** (cash costs **$120 / $220 / $350** in `CONSTANTS.hkTraining.upgradeCosts`). Each level increases the in-room `cleanliness` gain by **+42%** of the base rate for **all** housekeepers (`getHousekeeperCleanRate()`). Management tab: **Upgrade training** button + level readout. Persisted in save/load as `hkTrainingLevel`; reset on New Game.

## [0.3.13] - 2026-05-25
### Removed
- **Passive dirty-room cleaning** — dirty suites no longer slowly return to `ready` in `simulationStep`; they stay dirty until a **housekeeper** cleans them or you **click the room** on the canvas (manual sweep in `renderer.js`).

## [0.3.12] - 2026-05-25
### Changed
- **Staff = hire fee only** — kept **one-time** recruit costs (**$30** housekeeper, **$75** builder, **$40** receptionist) but **removed all per-second wage deductions** from `simulationStep` (no payroll drain, no wage-based auto-dismiss, no “wages running out” toast). `CONSTANTS.staff` no longer defines `wage`.
- **Ledger / Management copy** — payroll line shows **“— (hire fee only)”**; staff cards explain **no per-second wages**. AI agent prompt + `readState` treat `wagesPerSec` as **0**.

## [0.3.11] - 2026-05-25
### Changed
- **Staff wages vs small-hotel income** — wages cut again for ~**$2/s**-scale operations: housekeeper **$0.12/s** (hire **$30**), receptionist **$0.12/s** (**$40**), builder **$0.22/s** (**$75**). One of each is **~$0.46/s** total instead of **$2/s**.
- **Ledger readability** — rent / wages / net lines show **two decimal places** so fractional payroll is obvious.

## [0.3.10] - 2026-05-25
### Changed
- **Staff pricing (again)** — further reduced so hiring is a light early-game expense: housekeeper **$60 / $0.50·s⁻¹**, builder **$180 / $1·s⁻¹**, receptionist **$80 / $0.50·s⁻¹** (`CONSTANTS.staff` + Management tab + agent prompt).

## [0.3.9] - 2026-05-25
### Changed
- **Staff pricing** — hire bonuses and wages reduced so early hires pay back faster: housekeeper **$220 / $1·s⁻¹** (was $500 / $2), builder **$500 / $2** (was $800 / $3), receptionist **$260 / $1.5·s⁻¹** (was $400 / $3). Management tab copy updated; `CONSTANTS.staff` in `js/game-state.js` is the source of truth.

## [0.3.8] - 2026-05-25
### Added
- **Momentum HUD** — header shows lifetime guest **stays**, **tips** earned, and a **rush countdown** when a booking frenzy is active
- **Rush hour** — random ~40s waves of higher check-in odds so the lobby feels less idle
- **Tips & combo payouts** — most checkouts roll a small **tip** (golden floaties + `playTip` chime); back-to-back checkouts within 10s grant a **combo cash bonus**
- **Milestone toasts** — celebrate stay counts at 1, 5, 10, 25, 50, and 100 completed stays
- **VIP walk-ins** — Deluxe (lvl 2+) vacant rooms can rarely spawn a **VIP** booking with a heads-up toast

### Changed
- **Pacing** — slightly **higher base booking chance** (0.32 vs 0.25) and **shorter guest stays** so rent hits the register more often

## [0.3.7] - 2026-05-25
### Fixed (AI agent)
- **Affordability spam in JSONL** — long runs showed dozens of `blocked_action` rows where the model kept choosing `build_room` while `canBuildRoom` was false. The user prompt now ends with an explicit **Valid actions this turn** list derived from `affordability`, and illegal picks are **clamped to `wait`** with an `override` log (`affordability_clamp`) instead of burning a tick on a blocked action.
- **Malformed `hire_staff:role` / `fire_staff:role` labels** — some models copied the shorthand from the allowed-action list into the JSON `action` field, which bypassed `execute()`'s `hire_staff` switch. Those labels are now **normalized** to `hire_staff` / `fire_staff` plus `params.type`, and the prompt uses parentheses instead of `type:value` shorthands.
- **Clamp wiring regression** — a bad edit dropped the `clampActionToAffordability(...)` destructuring (ReferenceError each tick). Restored so affordability clamping runs after `normalizeActionShape`.

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
