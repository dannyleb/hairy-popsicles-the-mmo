import Phaser from 'phaser';
import { applyRenderScale, canvasSize, renderScale } from './display.js';
import { takeInviteFromUrl } from './net/invite.js';
import './net/status.js';  // starts waking the server while everything else loads
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { WorldScene } from './scenes/WorldScene.js';

takeInviteFromUrl();

// iPhones ignore user-scalable=no: a pinch on the HUD would zoom the whole page
// (blurring the game and pushing the HUD off the edge) and leave it there.
// Pinching the world still zooms the camera: that's touch events, not these.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}
const [width, height] = canvasSize();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width,
  height,
  backgroundColor: '#0e0608',
  render: {
    // Sprites are drawn well below their texture size; without mipmaps they sparkle when shrunk.
    mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
    // On laptops with two GPUs, the faster one.
    powerPreference: 'high-performance',
    // Smoothed polygon edges cost several copies of the screen in GPU memory,
    // and on a phone's dense screen they make no visible difference.
    antialiasGL: renderScale() < 2,
  },
  // 120 Hz laptop screens would otherwise draw every frame twice as often as a
  // phone does. Just over 60, so a 60 Hz screen never skips one.
  fps: { limit: 62 },
  scale: { mode: Phaser.Scale.NONE, zoom: 1 / renderScale() },
  scene: [BootScene, MenuScene, WorldScene],
});

window.addEventListener('resize', () => applyRenderScale(game));

// A phone short of memory can take the graphics context from a tab in the
// background. When it gives it back, Phaser rebuilds every texture from its
// loaded image, but on iPhones some come back blank (the image's pixels were
// thrown away, and the temporary link it was loaded through is gone): the
// characters, crops and plots vanish while the ground and labels still draw.
// Start fresh instead; everything that matters is on the server. Not twice in
// a minute, in case the phone keeps taking it.
const RESTORED_KEY = 'hptm:restoredAt';
game.events.once(Phaser.Core.Events.READY, () => {
  game.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, () => {
    try {
      if (Date.now() - (Number(sessionStorage.getItem(RESTORED_KEY)) || 0) < 60_000) return;
      sessionStorage.setItem(RESTORED_KEY, String(Date.now()));
    } catch {
      // Can't tell if it just did: reload anyway, a blank world is worse.
    }
    window.location.reload();
  });
});
