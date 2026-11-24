import { makeFakeWindow } from './fakes.js';

export function fakePlayer({ videoId = 'abc123', t = 123.4 } = {}) {
  const calls = [];
  return {
    calls,
    getVideoData: () => ({ video_id: videoId }),
    getCurrentTime: () => t,
    loadVideoById: (id, start) => calls.push(['loadVideoById', id, start]),
    setPlaybackQualityRange: (a, b) =>
      calls.push(['setPlaybackQualityRange', a, b])
  };
}

export function domWindow(world, { withAudio = true } = {}) {
  const win = { ...world.win, ...makeFakeWindow() };
  if (!withAudio) delete win.AudioDecoder;
  return win;
}
