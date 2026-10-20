import Phaser from 'phaser';
import { DPR } from './display.js';
import { BootScene } from './scenes/BootScene.js';
import { WorldScene } from './scenes/WorldScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: window.innerWidth * DPR,
  height: window.innerHeight * DPR,
  backgroundColor: '#1a0f14',
  // Character sprites are 256px squares shown at ~60px; without mipmaps they sparkle when shrunk.
  render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR' },
  scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR },
  scene: [BootScene, WorldScene],
});

window.addEventListener('resize', () => game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR));
