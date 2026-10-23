import { hasHaptics, sfx } from '../audio/sfx.js';
import { resetQuality } from '../display.js';
import { settings } from '../settings.js';
import { el } from './dom.js';

// The settings' on/off switches, as the title menu and the in-game sheet both show them.
const TOGGLES = [
  { name: 'sound', label: 'Sound effects' },
  { name: 'music', label: 'Music' },
  { name: 'bubbles', label: 'Speech bubbles' },
  ...(hasHaptics ? [{ name: 'haptics', label: 'Vibration' }] : []),
  { name: 'calm', label: 'Reduce motion' },
  // On by default: never lighten the graphics on its own, even if that costs
  // some smoothness. Off lets a struggling device trade sharpness for speed.
  { name: 'fullSharpness', label: 'Always full sharpness', reload: true },
  // Off Who's around (anyone in the world still sees you there).
  { name: 'appearOffline', label: 'Appear offline' },
];

export function settingToggles(listClass, rowClass) {
  const list = el('div', listClass);
  for (const { name, label, reload } of TOGGLES) {
    const row = el('label', rowClass);
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = settings.get(name);
    toggle.addEventListener('change', () => {
      settings.set(name, toggle.checked);
      sfx.click();
      // The graphics are set up once, at load.
      if (reload && toggle.checked) {
        resetQuality();
        window.location.reload();
      }
    });
    row.append(el('span', null, label), toggle);
    list.append(row);
  }
  return list;
}
