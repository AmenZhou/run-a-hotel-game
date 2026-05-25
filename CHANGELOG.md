# Changelog

## [Unreleased]

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
