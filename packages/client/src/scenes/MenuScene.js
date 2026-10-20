import Phaser from 'phaser';
import { DPR } from '../display.js';
import { connect } from '../net/connection.js';
import { loading } from '../ui/loading.js';
import { createMenu } from '../ui/menu.js';
import { createBackdrop } from '../world/backdrop.js';
import { WORLD_H, WORLD_W } from '../world/layout.js';

// The free Render server sleeps when idle; waking it takes up to a minute.
const SLOW_CONNECT_MS = 4000;
const DRIFT_SPEED = 0.00004;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0e0608').setZoom(DPR).setBounds(0, 0, WORLD_W, WORLD_H);
    this.backdrop = createBackdrop(this);
    this.drift = Math.random() * Math.PI * 2;
    this.menu = createMenu({ onPlay: (name) => this.play(name) });
    loading.hide();
  }

  async play(name) {
    this.menu.hide();
    loading.show('Connecting...');
    const slow = setTimeout(() => loading.status('Waking up the server. Free servers nap; this can take up to a minute.'), SLOW_CONNECT_MS);
    try {
      const room = await connect(name);
      this.menu.destroy();
      this.scene.start('world', { room });
      loading.hide();
    } catch {
      loading.error("Couldn't reach the server.", () => this.play(name));
    } finally {
      clearTimeout(slow);
    }
  }

  update(time, delta) {
    // A slow wander over the world behind the menu.
    this.drift += delta * DRIFT_SPEED;
    const camera = this.cameras.main;
    camera.centerOn(WORLD_W / 2 + Math.cos(this.drift) * 700, WORLD_H / 2 + Math.sin(this.drift * 1.3) * 500);
    this.backdrop.update(time, delta, camera);
  }
}
