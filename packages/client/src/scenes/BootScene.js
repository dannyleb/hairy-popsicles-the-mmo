import Phaser from 'phaser';
import { CHARACTERS } from '@hptm/shared';
import { DPR } from '../display.js';
import { connect } from '../net/connection.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.cameras.main.setZoom(DPR).setOrigin(0, 0);
    this.status = this.add.text(20, 20, 'Loading...', { fontSize: '16px', color: '#ffe8d6', resolution: DPR });
    for (const { id } of CHARACTERS) {
      this.load.image(`char:${id}`, `${import.meta.env.BASE_URL}characters/small/${id}.webp`);
    }
  }

  async create() {
    this.status.setText('Connecting...');
    const name = `Guest${Math.floor(Math.random() * 10000)}`;
    const room = await connect(name);
    this.scene.start('world', { room });
  }
}
