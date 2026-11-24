import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toastModel, formatSpeed } from '../../src/speed/speed-toast.js';

test('formatSpeed uses the pt-BR decimal comma', () => {
  assert.equal(formatSpeed(1.5, 'pt'), '1,5×');
  assert.equal(formatSpeed(1.5, 'en'), '1.5×');
  assert.equal(formatSpeed(2), '2×');
});

test('counting: whole seconds, ring follows the eta', () => {
  const m = toastModel(
    { state: 'pending', target: 2, etaS: 3.2 },
    2,
    6.4,
    'pt'
  );
  assert.equal(m.phase, 'counting');
  assert.equal(m.title, 'Mudando para 2×');
  assert.equal(m.subtitle, 'em 4 s');
  assert.equal(m.progress, 0.5);
});

test('done when the new speed plays', () => {
  const m = toastModel({ state: 'done', target: 1.5, etaS: 0 }, 1.5, 4, 'pt');
  assert.equal(m.phase, 'done');
  assert.equal(m.title, 'Velocidade 1,5×');
  assert.equal(m.subtitle, 'Ativada agora');
});

test('back to normal reads as such', () => {
  assert.equal(
    toastModel({ state: 'scheduled', target: 1, etaS: 2 }, 1, 2, 'pt').title,
    'Voltando ao normal'
  );
  assert.equal(
    toastModel({ state: 'done', target: 1, etaS: 0 }, 1, 2, 'pt').title,
    'Velocidade normal'
  );
});

test('hidden without a session or for another target', () => {
  assert.equal(toastModel(null, 2, 0).phase, 'hidden');
  assert.equal(
    toastModel({ state: 'pending', target: 1.5, etaS: 2 }, 2, 2).phase,
    'hidden'
  );
});

test('English elsewhere', () => {
  const m = toastModel(
    { state: 'pending', target: 1.5, etaS: 2.1 },
    1.5,
    3,
    'en'
  );
  assert.equal(m.title, 'Changing to 1.5×');
  assert.equal(m.subtitle, 'in 3 s');
});
