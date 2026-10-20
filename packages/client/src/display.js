import { settings } from './settings.js';

// Phaser draws at CSS-pixel size by default, which phones then stretch 2-3x and
// blur. The game canvas is sized in device pixels instead, shown at CSS size,
// with every camera zoomed by the render scale (times worldZoom on big screens)
// so world units stay CSS pixels.
//
// Phones get their full pixel density: that's what makes the art crisp, and it's
// only ~3.6M pixels. A big high-density laptop screen at full density is far more
// pixels for the same picture, and the GPU pays for every one each frame (that
// made laptops lag), so past PIXEL_BUDGET the game draws a little softer instead.
// Decided from the screen, not the window, so it never changes mid-game.
const PIXEL_BUDGET = 3_600_000;
const deviceRatio = Math.min(window.devicePixelRatio || 1, 3);
const screenArea = (window.screen?.width || window.innerWidth) * (window.screen?.height || window.innerHeight);
const budgetRatio = Math.max(1, Math.min(deviceRatio, Math.sqrt(PIXEL_BUDGET / screenArea)));

// If frames still come slowly (an old laptop, or a browser drawing without the
// graphics card), the game steps down through these and remembers where it
// landed: first the resolution, then the purely ambient glows (candle light,
// fireflies, walking trails), then a softer resolution still.
const QUALITY = [
  { scale: budgetRatio, lite: false },
  { scale: Math.min(budgetRatio, 1), lite: false },
  { scale: Math.min(budgetRatio, 1), lite: true },
  { scale: 0.75, lite: true },
];
let level = Math.min(QUALITY.length - 1, Math.max(0, Math.floor(Number(settings.get('quality')) || 0)));

export const quality = () => QUALITY[level];
export const renderScale = () => QUALITY[level].scale;
export const fullQuality = () => level === 0;

// One step down (skipping steps that change nothing here); false at the bottom.
export function lowerQuality(toLowest = false) {
  const before = QUALITY[level];
  while (level < QUALITY.length - 1) {
    level += 1;
    const now = QUALITY[level];
    if (!toLowest && (now.scale !== before.scale || now.lite !== before.lite)) break;
  }
  settings.set('quality', level);
  return QUALITY[level] !== before;
}

export function resetQuality() {
  level = 0;
  settings.set('quality', 0);
}

// The canvas at the current render scale, shown at the window's CSS size.
export const canvasSize = () => [Math.round(window.innerWidth * renderScale()), Math.round(window.innerHeight * renderScale())];
export function applyRenderScale(game) {
  game.scale.setZoom(1 / renderScale());
  game.scale.resize(...canvasSize());
}

// A browser drawing WebGL without the graphics card (hardware acceleration off,
// or the GPU blocklisted) manages a few frames a second whatever the game does.
export function drawingInSoftware(game) {
  const gl = game.renderer?.gl;
  if (!gl) return true;  // the canvas renderer: no WebGL at all
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

// Bigger screens see the world closer, so a desktop or tablet doesn't shrink
// everyone to ants. Phones (about 360-430 px across) stay at 1.
export function worldZoom() {
  return Math.min(2.2, Math.max(1, Math.min(window.innerWidth, window.innerHeight) / 420));
}

// Camera zoom: device pixels times world zoom.
export const cameraZoom = () => renderScale() * worldZoom();

// Text drawn into the canvas, at the resolution it's shown at.
export const textResolution = () => Math.max(1, renderScale() * worldZoom());

// In portrait the HUD sits along the top, so the camera looks a bit ahead of
// you (your plot is just above you); in landscape the HUD is at the sides.
export const lookAhead = () => (window.innerHeight > window.innerWidth ? 70 : 0);
