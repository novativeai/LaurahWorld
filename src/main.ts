import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';

new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#ffffff',
  scene: [WorldScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
});
