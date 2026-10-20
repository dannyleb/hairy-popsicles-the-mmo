// Phaser draws at CSS-pixel size by default, which phones then stretch 2-3x and
// blur. The game canvas is sized in device pixels instead, shown at CSS size,
// with every camera zoomed by DPR so world units stay CSS pixels.
export const DPR = Math.min(window.devicePixelRatio || 1, 3);
