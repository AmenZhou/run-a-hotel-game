// Renderer HUD — notification overlays and floor label overlays
// Depends on: constants.js, state.js, simulation.js, renderer-core.js, renderer-fp.js
//
// drawParticles is defined inline in renderer-core.js (inside the CanvasRenderer object)
// and drawLoop lives in ui.js. This file is the correct home for any future HUD
// overlay additions (e.g. achievement banners, floor labels, notification toasts on canvas).
//
// Currently a pass-through — all HUD rendering is handled by renderer-core.js methods.
