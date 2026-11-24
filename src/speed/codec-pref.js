/**
 * Makes YouTube pick VP9 (or H.264) instead of AV1 while playback speed is on.
 *
 * Faster speeds feed the hardware decoder more frames per second. Measured on
 * an LG OLED C1 (webOS 6), 1080p30 at 2x (60 frames/s): AV1 dropped 15 frames
 * per second (7 at 1.75x), so the picture stuttered; VP9 of the same video and
 * AV1 at 720p dropped none. The element's own playbackRate is ignored on webOS
 * 6, so there is no native path to fall back to.
 *
 * @param {Window} win
 * @returns {() => void} restore
 */
export function preferNonAv1(win) {
  const MS = win.MediaSource;
  if (!MS || typeof MS.isTypeSupported !== 'function') return () => {};
  const original = MS.isTypeSupported;
  MS.isTypeSupported = function (type) {
    if (/av01/i.test(String(type))) return false;
    return original.call(this, type);
  };
  return () => {
    MS.isTypeSupported = original;
  };
}
