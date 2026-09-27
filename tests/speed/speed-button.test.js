// The "Speed" entry of the settings panel: the server disables it per device.
// The fixture is the real `transportControls` of a `/next` response captured
// from an LG OLED C4 (webOS 24), not a hand-written copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  enableSpeedButton,
  installSpeedButtonPatch,
  SPEED_BUTTON_TYPE,
  SPEED_OVERLAY_TYPE
} from '../../src/speed/speed-button.js';

const FIXTURE = new URL(
  './fixtures/next-transport-controls.webos24.json',
  import.meta.url
);
const raw = () => readFileSync(FIXTURE, 'utf8');

function actions(r) {
  const tc = r.transportControls.transportControlsRenderer;
  return Object.values(tc).filter(Array.isArray).flat();
}
const speedOf = (r) =>
  actions(r).find((a) => a.type === SPEED_BUTTON_TYPE).button.buttonRenderer;

test('the captured response really disables the speed button', () => {
  const r = JSON.parse(raw());
  assert.equal(
    speedOf(r).isDisabled,
    true,
    'fixture no longer shows the problem'
  );
  assert.equal(
    speedOf(r).command.openClientOverlayAction.type,
    SPEED_OVERLAY_TYPE
  );
});

test('enableSpeedButton enables it and touches nothing else', () => {
  const r = JSON.parse(raw());
  const before = JSON.parse(raw());
  assert.equal(enableSpeedButton(r), 1);
  assert.equal(speedOf(r).isDisabled, false);
  speedOf(before).isDisabled = false;
  assert.deepEqual(
    r,
    before,
    'only the isDisabled flag of the speed button changes'
  );
  assert.equal(enableSpeedButton(r), 0, 'idempotent');
});

test('a disabled button without a command gets the speed overlay command', () => {
  const r = JSON.parse(raw());
  delete speedOf(r).command;
  enableSpeedButton(r);
  assert.deepEqual(speedOf(r).command, {
    openClientOverlayAction: { type: SPEED_OVERLAY_TYPE }
  });
});

test('responses without transport controls are left alone', () => {
  for (const r of [
    null,
    1,
    'x',
    [],
    {},
    { transportControls: null },
    { transportControls: { transportControlsRenderer: 5 } }
  ]) {
    assert.equal(enableSpeedButton(r), 0);
  }
});

test('the JSON.parse patch applies only while the feature is on, and restores', () => {
  const win = { JSON: { parse: JSON.parse } };
  let on = true;
  const restore = installSpeedButtonPatch(win, () => on);
  assert.equal(speedOf(win.JSON.parse(raw())).isDisabled, false);
  on = false;
  assert.equal(speedOf(win.JSON.parse(raw())).isDisabled, true);
  assert.deepEqual(
    win.JSON.parse('[1,{"a":2}]'),
    [1, { a: 2 }],
    'other payloads unchanged'
  );
  assert.equal(win.JSON.parse('null'), null);
  restore();
  assert.equal(win.JSON.parse, JSON.parse);
});
