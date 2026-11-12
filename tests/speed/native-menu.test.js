// YouTube's own speed menu: enabled through the player config flag
// found in tv-player-ias.js, and bound to the controller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enableNativeSpeedMenu,
  bindPlayerRate,
  hookRateAssignments,
  IGNORE_AFTER_RELOAD_MS
} from '../../src/speed/native-menu.js';

test('the player config flag reads true unless a config sets it itself', () => {
  'use strict';
  const restore = enableNativeSpeedMenu(globalThis);
  try {
    assert.equal({}.enableSpeedOptions, true);
    const own = {};
    own.enableSpeedOptions = false; // assignment works, even in strict mode
    assert.equal(own.enableSpeedOptions, false);
    class Config {
      constructor(f) {
        this.enableSpeedOptions = f.enableSpeedOptions || false;
      }
    }
    assert.equal(
      new Config({}).enableSpeedOptions,
      true,
      'the TV player expression now yields true'
    );
    assert.ok(
      !Object.keys({}).includes('enableSpeedOptions'),
      'not enumerable'
    );
  } finally {
    restore();
  }
  assert.equal({}.enableSpeedOptions, undefined, 'restore removes it');
});

function fakeController() {
  const calls = [];
  let speed = 1;
  let reloadAt = 0;
  return {
    calls,
    setSpeed(s) {
      calls.push(s);
      speed = s;
    },
    getSpeed: () => speed,
    lastReloadAt: () => reloadAt,
    _reload(t) {
      reloadAt = t;
    }
  };
}

test('choosing a speed in the menu reaches the controller, and YouTube still gets the call', () => {
  const orig = [];
  const player = {
    setPlaybackRate(r) {
      orig.push(r);
    }
  };
  const ctl = fakeController();
  let now = 100000;
  assert.equal(
    bindPlayerRate(player, ctl, () => now),
    true
  );
  player.setPlaybackRate(1.5);
  assert.deepEqual(orig, [1.5]);
  assert.deepEqual(ctl.calls, [1.5]);
  player.setPlaybackRate(0.75);
  assert.deepEqual(ctl.calls, [1.5, 0.75]);
});

test('binding twice does not wrap twice', () => {
  const orig = [];
  const player = {
    setPlaybackRate(r) {
      orig.push(r);
    }
  };
  const ctl = fakeController();
  bindPlayerRate(player, ctl, () => 1e6);
  assert.equal(
    bindPlayerRate(player, ctl, () => 1e6),
    false
  );
  player.setPlaybackRate(2);
  assert.deepEqual(orig, [2]);
  assert.deepEqual(ctl.calls, [2]);
});

test('YouTube restoring its rate right after our reload is not taken as a choice', () => {
  const player = { setPlaybackRate() {} };
  const ctl = fakeController();
  let now = 50000;
  bindPlayerRate(player, ctl, () => now);
  ctl._reload(now);
  now += IGNORE_AFTER_RELOAD_MS - 500;
  player.setPlaybackRate(1);
  assert.deepEqual(ctl.calls, []);
  now += 1000;
  player.setPlaybackRate(1.25);
  assert.deepEqual(ctl.calls, [1.25]);
});

test('unsupported or unchanged rates do nothing', () => {
  const player = { setPlaybackRate() {} };
  const ctl = fakeController();
  bindPlayerRate(player, ctl, () => 1e6);
  player.setPlaybackRate(3);
  player.setPlaybackRate('abc');
  player.setPlaybackRate(1);
  assert.deepEqual(ctl.calls, []);
});

test('a missing player or one without setPlaybackRate is ignored', () => {
  assert.equal(bindPlayerRate(null, fakeController()), false);
  assert.equal(bindPlayerRate({}, fakeController()), false);
});

// YouTube's player proxy, as built in tv-player-ias.js, minified
// names kept:
//   function CVH(f){... var G=k.getApiInterface(); ... for(var t=f.api,Z=0;Z<G.length;Z++){var u=G[Z];t[u]||(t[u]=QQ(f,k,u))} ...}
//   function QQ(f,k,G){var t=k[G];return function(){... return f.lastError=null,t.apply(k,Z) ...}}
// The settings menu calls `f.api.setPlaybackRate`, never the element.
function youtubeProxy(k) {
  function QQ(f, k, G) {
    const t = k[G];
    return function () {
      const Z = [...arguments];
      f.lastError = null;
      return t.apply(k, Z);
    };
  }
  const f = { api: {} };
  const G = k.getApiInterface();
  for (let t = f.api, Z = 0; Z < G.length; Z++) {
    const u = G[Z];
    t[u] || (t[u] = QQ(f, k, u));
  }
  return f.api;
}

test("the menu path through YouTube's player proxy reaches the controller", () => {
  const ctl = fakeController();
  let now = 1e6;
  const restore = hookRateAssignments(globalThis, ctl, () => now);
  try {
    const native = [];
    const element = {
      getApiInterface: () => ['getPlaybackRate', 'setPlaybackRate'],
      getPlaybackRate: () => native.at(-1) ?? 1,
      setPlaybackRate(r) {
        native.push(r);
      }
    };
    const api = youtubeProxy(element);
    assert.equal(
      typeof api.setPlaybackRate,
      'function',
      'the `t[u] ||` test still lets YouTube assign'
    );
    api.setPlaybackRate(1.5);
    assert.deepEqual(native, [1.5], 'YouTube still gets the call');
    assert.deepEqual(ctl.calls, [1.5]);
    ctl._reload(now);
    now += 1000;
    api.setPlaybackRate(1);
    assert.deepEqual(ctl.calls, [1.5], 'restore after our reload ignored');
    // Binding the element afterwards (the 1 s poll) must not double the calls.
    bindPlayerRate(element, ctl, () => now);
    now += IGNORE_AFTER_RELOAD_MS;
    api.setPlaybackRate(2);
    assert.deepEqual(ctl.calls, [1.5, 2]);
  } finally {
    restore();
  }
  assert.equal({}.setPlaybackRate, undefined);
  assert.ok(!('setPlaybackRate' in {}), 'restore removes it');
});

test('class prototypes and non-functions are stored untouched', () => {
  const ctl = fakeController();
  const restore = hookRateAssignments(globalThis, ctl, () => 1e6);
  try {
    function Internal() {}
    const own = function (r) {
      this.r = r;
    };
    Internal.prototype.setPlaybackRate = own;
    assert.equal(
      Internal.prototype.setPlaybackRate,
      own,
      'internal prototype method not wrapped'
    );
    new Internal().setPlaybackRate(1.5);
    assert.deepEqual(ctl.calls, []);
    const o = {};
    o.setPlaybackRate = 5;
    assert.equal(o.setPlaybackRate, 5);
    assert.ok(Object.keys(o).includes('setPlaybackRate'));
  } finally {
    restore();
  }
});
