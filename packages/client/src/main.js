import Phaser from 'phaser';
import { DPR } from './display.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { WorldScene } from './scenes/WorldScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: window.innerWidth * DPR,
  height: window.innerHeight * DPR,
  backgroundColor: '#0e0608',
  // Sprites are drawn well below their texture size; without mipmaps they sparkle when shrunk.
  render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR' },
  scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR },
  scene: [BootScene, MenuScene, WorldScene],
});

window.addEventListener('resize', () => game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR));
