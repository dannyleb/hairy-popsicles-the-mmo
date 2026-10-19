import Phaser from 'phaser';
import { connect } from '../net/connection.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  async create() {
    this.add.text(20, 20, 'Connecting...', { fontSize: '16px', color: '#ffe8d6' });
    const name = `Guest${Math.floor(Math.random() * 10000)}`;
    const room = await connect(name);
    this.scene.start('world', { room });
  }
}
