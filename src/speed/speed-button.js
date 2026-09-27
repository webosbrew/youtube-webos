/**
 * Turns on the "Speed" entry of the player's settings panel.
 *
 * The server decides it per device: for this TV the `/youtubei/v1/next`
 * response carries (captured on an LG OLED C4, webOS 24)
 *   transportControls.transportControlsRenderer.settingActions[i] =
 *     { type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED_BUTTON',
 *       button: { buttonRenderer: { isDisabled: true, command: {
 *         openClientOverlayAction: { type: 'CLIENT_OVERLAY_TYPE_VIDEO_PLAYBACK_SPEED' } } } } }
 * and the panel shows "Not available on this device" whenever `isDisabled` is
 * set. The same request from the same page without the device fields gets
 * `isDisabled: false`: the client itself has nothing against it. The speed
 * overlay then ends in `player.setPlaybackRate`, bound in native-menu.js.
 */

export const SPEED_BUTTON_TYPE = 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED_BUTTON';
export const SPEED_OVERLAY_TYPE = 'CLIENT_OVERLAY_TYPE_VIDEO_PLAYBACK_SPEED';

/**
 * Enables the speed button in a parsed response, in place.
 * @param {unknown} response
 * @returns {number} buttons enabled
 */
export function enableSpeedButton(response) {
  const renderer =
    response &&
    response.transportControls &&
    response.transportControls.transportControlsRenderer;
  if (!renderer || typeof renderer !== 'object') return 0;
  let enabled = 0;
  for (const key of Object.keys(renderer)) {
    const actions = renderer[key];
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (!action || action.type !== SPEED_BUTTON_TYPE) continue;
      const button = action.button && action.button.buttonRenderer;
      if (!button || !button.isDisabled) continue;
      button.isDisabled = false;
      if (!button.command) {
        button.command = {
          openClientOverlayAction: { type: SPEED_OVERLAY_TYPE }
        };
      }
      enabled++;
    }
  }
  return enabled;
}

/**
 * Wraps `JSON.parse` so every response is patched as it is read. YouTube keeps
 * its own reference to `JSON.parse` from startup, so this must run at
 * document-start, like adblock.js (which then wraps this wrapper).
 * @param {Window} win
 * @param {() => boolean} isOn
 * @returns {() => void} restore
 */
export function installSpeedButtonPatch(win, isOn) {
  const json = win.JSON || JSON;
  const original = json.parse;
  const patched = function () {
    const r = original.apply(this, arguments);
    if (r && typeof r === 'object' && r.transportControls && isOn()) {
      enableSpeedButton(r);
    }
    return r;
  };
  json.parse = patched;
  return () => {
    if (json.parse === patched) json.parse = original;
  };
}
