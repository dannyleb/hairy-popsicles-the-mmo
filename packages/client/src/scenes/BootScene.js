import Phaser from 'phaser';
import { CHARACTERS } from '@hptm/shared';
import { loading } from '../ui/loading.js';
import { WORLD_TEXTURES } from '../world/backdrop.js';

const FONT_WAIT_MS = 2500;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.load.on('progress', (share) => loading.progress(share));
    const base = import.meta.env.BASE_URL;
    for (const { id } of CHARACTERS) this.load.image(`char:${id}`, `${base}characters/small/${id}.webp`);
    for (const name of WORLD_TEXTURES) this.load.image(`world:${name}`, `${base}world/${name}.webp`);
  }

  async create() {
    // Text drawn into the canvas before the web font arrives stays in the fallback font, so wait for it (briefly).
    loading.status('Almost...');
    await Promise.race([
      document.fonts.load('16px "Patrick Hand"'),
      new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
    ]).catch(() => {});
    this.scene.start('menu');
  }
}
