// Phaser draws at CSS-pixel size by default, which phones then stretch 2-3x and
// blur. The game canvas is sized in device pixels instead, shown at CSS size,
// with every camera zoomed by DPR (times worldZoom on big screens) so world
// units stay CSS pixels.
export const DPR = Math.min(window.devicePixelRatio || 1, 3);

// Bigger screens see the world closer, so a desktop or tablet doesn't shrink
// everyone to ants. Phones (about 360-430 px across) stay at 1.
export function worldZoom() {
  return Math.min(2.2, Math.max(1, Math.min(window.innerWidth, window.innerHeight) / 420));
}

// Camera zoom: device pixels times world zoom.
export const cameraZoom = () => DPR * worldZoom();

// Text drawn into the canvas, at the resolution it's shown at.
export const textResolution = () => DPR * worldZoom();

// In portrait the HUD sits along the top, so the camera looks a bit ahead of
// you (your plot is just above you); in landscape the HUD is at the sides.
export const lookAhead = () => (window.innerHeight > window.innerWidth ? 70 : 0);
