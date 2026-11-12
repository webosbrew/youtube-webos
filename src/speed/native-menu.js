import { isSupportedSpeed } from './timemap.js';

/**
 * Turns on YouTube's own "Playback speed" menu.
 *
 * The TV player decides whether speed options exist with (tv-player-ias.js,
 * read on an LG OLED C4, webOS 24):
 *   this.enableSpeedOptions = f.enableSpeedOptions || (<platform checks>)
 * where `f` is the player config. The platform checks fail on webOS, hence
 * "not available on this device". A getter on Object.prototype makes any config
 * that does not set the flag itself read `true`; the setter turns assignments
 * into own properties, so objects that do set it keep their value.
 *
 * @param {Window} win
 * @returns {() => void} restore
 */
export function enableNativeSpeedMenu(win) {
  const proto = (win.Object || Object).prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, 'enableSpeedOptions');
  Object.defineProperty(proto, 'enableSpeedOptions', {
    configurable: true,
    enumerable: false,
    get() {
      return true;
    },
    set(value) {
      Object.defineProperty(this, 'enableSpeedOptions', {
        value,
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
  });
  return () => {
    if (previous) Object.defineProperty(proto, 'enableSpeedOptions', previous);
    else delete proto.enableSpeedOptions;
  };
}

/**
 * Routes the speed chosen in YouTube's menu to the controller.
 *
 * The menu does not call the player element: it calls a proxy object that the
 * player builds once, at startup (tv-player-ias.js, read on an LG OLED C4, webOS 24):
 *   var G = k.getApiInterface() ... ; for (...) t[u] || (t[u] = QQ(f, k, u))
 * where `t` is a plain object and `QQ` captures `k[u]`, the element's method, at
 * that moment. Wrapping the element later (bindPlayerRate) never sees the menu.
 * So the assignment itself is intercepted: an accessor on Object.prototype
 * whose getter reads `undefined` (the `t[u] ||` test must still fail) and whose
 * setter stores the function as an own property, wrapped when the target is
 * a plain object like `t`. Class prototypes (own `constructor`) are left alone:
 * YouTube's internals restore rates on their own and are not user choices.
 *
 * @param {Window} win
 * @param {{ setSpeed(s: number): void, getSpeed(): number, lastReloadAt(): number }} controller
 * @param {() => number} now milliseconds
 * @returns {() => void} restore
 */
export function hookRateAssignments(win, controller, now = () => Date.now()) {
  const proto = (win.Object || Object).prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, 'setPlaybackRate');
  Object.defineProperty(proto, 'setPlaybackRate', {
    configurable: true,
    enumerable: false,
    get() {
      return undefined;
    },
    set(fn) {
      if (Object(this) !== this) return;
      const plain =
        Object.getPrototypeOf(this) === proto &&
        !Object.hasOwn(this, 'constructor');
      Object.defineProperty(this, 'setPlaybackRate', {
        value:
          plain && typeof fn === 'function'
            ? wrapRate(fn, controller, now)
            : fn,
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
  });
  return () => {
    if (previous) Object.defineProperty(proto, 'setPlaybackRate', previous);
    else delete proto.setPlaybackRate;
  };
}

/**
 * Same routing for the player element, bound after it appears.
 *
 * @param {object} player the `.html5-video-player` element (YouTube's player API)
 * @param {{ setSpeed(s: number): void, getSpeed(): number, lastReloadAt(): number }} controller
 * @param {() => number} now milliseconds
 * @returns {boolean} true if the player was bound by this call
 */
export function bindPlayerRate(player, controller, now = () => Date.now()) {
  if (
    !player ||
    typeof player.setPlaybackRate !== 'function' ||
    player.__ytafSpeedBound
  )
    return false;
  const original = player.setPlaybackRate;
  player.__ytafOriginalSetPlaybackRate = original.__ytafUnwrapped || original;
  if (!original.__ytafUnwrapped)
    player.setPlaybackRate = wrapRate(original, controller, now);
  player.__ytafSpeedBound = true;
  return true;
}

/**
 * The original still runs, so YouTube's own state and UI follow; the controller
 * then reloads the video at the new speed. Calls right after one of our reloads
 * are YouTube restoring its own rate, not the user: they are ignored.
 */
function wrapRate(original, controller, now) {
  if (original.__ytafUnwrapped) return original;
  const wrapped = function (rate) {
    const result = original.apply(this, arguments);
    const r = Number(rate);
    const sinceReload = now() - controller.lastReloadAt();
    if (
      isSupportedSpeed(r) &&
      r !== controller.getSpeed() &&
      sinceReload > IGNORE_AFTER_RELOAD_MS
    ) {
      controller.setSpeed(r);
    }
    return result;
  };
  wrapped.__ytafUnwrapped = original;
  return wrapped;
}

/** YouTube restores its own playback rate while a reloaded video starts. */
export const IGNORE_AFTER_RELOAD_MS = 3000;
