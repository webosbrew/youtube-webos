import { configRead } from './config';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager, VideoQualityData } from './player_api';

const VP09_CODEC = 'vp09';
const AV1_CODEC = 'av01';
const VP9_FORMAT_IDS = new Set([
  '278',
  '242',
  '243',
  '244',
  '247',
  '248',
  '271',
  '302',
  '303',
  '308',
  '313',
  '315',
  '330',
  '331',
  '332',
  '333',
  '334',
  '335',
  '336',
  '337'
]);

interface StreamingFormat {
  mimeType?: string;
  [key: string]: unknown;
}

interface StreamingData {
  formats?: StreamingFormat[];
  adaptiveFormats?: StreamingFormat[];
  [key: string]: unknown;
}

interface PlayerResponse {
  streamingData?: StreamingData;
  [key: string]: unknown;
}

function shouldForce() {
  return configRead('forceVp9Codec');
}

function isAv1MimeType(mimeType: string | undefined) {
  return mimeType?.includes(AV1_CODEC) ?? false;
}

function isVp09MimeType(mimeType: string | undefined) {
  return mimeType?.includes(VP09_CODEC) ?? false;
}

export function isVp9FormatId(formatId: string | undefined) {
  return formatId !== undefined && VP9_FORMAT_IDS.has(formatId);
}

export function getPreferredVp9FormatId(
  qualityData: VideoQualityData[] | undefined
) {
  return qualityData?.find((format) => {
    return format.isPlayable && isVp9FormatId(format.formatId);
  })?.formatId;
}

function isVideoFormat(format: StreamingFormat) {
  return format.mimeType?.startsWith('video/') ?? false;
}

function isVp09Format(format: StreamingFormat) {
  return isVp09MimeType(format.mimeType);
}

function filterFormats(formats: StreamingFormat[] | undefined) {
  if (!formats) return 0;

  const hasVp09Video = formats.some(
    (format) => isVideoFormat(format) && isVp09Format(format)
  );
  if (!hasVp09Video) return 0;

  const originalLength = formats.length;
  formats.splice(
    0,
    formats.length,
    ...formats.filter(
      (format) => !isVideoFormat(format) || isVp09Format(format)
    )
  );

  return originalLength - formats.length;
}

function forceVp09(playerResponse: PlayerResponse) {
  if (!shouldForce()) return;

  const streamingData = playerResponse.streamingData;
  if (!streamingData) return;

  const removedFormats = filterFormats(streamingData.formats);
  const removedAdaptiveFormats = filterFormats(streamingData.adaptiveFormats);
  const removedTotal = removedFormats + removedAdaptiveFormats;

  if (removedTotal > 0) {
    console.info(
      `[video-codec] Filtered ${removedTotal} non-VP09 video formats`
    );
  }
}

const origParse = JSON.parse;
JSON.parse = function (text, reviver) {
  const r = origParse(text, reviver);

  forceVp09(r);

  return r;
};

const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
HTMLMediaElement.prototype.canPlayType = function (mimeType) {
  if (shouldForce()) {
    if (isAv1MimeType(mimeType)) return '';
    if (isVp09MimeType(mimeType)) return 'probably';
  }

  return originalCanPlayType.call(this, mimeType);
};

const originalIsTypeSupported = window.MediaSource?.isTypeSupported;
if (originalIsTypeSupported) {
  window.MediaSource.isTypeSupported = function (mimeType) {
    if (shouldForce()) {
      if (isAv1MimeType(mimeType)) return false;
      if (isVp09MimeType(mimeType)) return true;
    }

    return originalIsTypeSupported.call(this, mimeType);
  };
}

const originalDecodingInfo = navigator.mediaCapabilities?.decodingInfo;
if (originalDecodingInfo) {
  navigator.mediaCapabilities.decodingInfo = function (configuration) {
    const mimeType = configuration.video?.contentType;
    if (shouldForce() && isAv1MimeType(mimeType)) {
      return Promise.resolve({
        supported: false,
        smooth: false,
        powerEfficient: false,
        keySystemAccess: null
      });
    }

    return originalDecodingInfo.call(this, configuration);
  };
}

type EventMap = EventMapOf<PlayerManager>;

function setVp09PlaybackFormat(this: PlayerManager, _: unknown) {
  if (this.playerMode === PlayerMode.PREVIEW) return;

  this.removeEventListener('playbackStart', setVp09PlaybackFormat);

  const formatId = getPreferredVp9FormatId(
    this.player.getAvailableQualityData()
  );
  if (!formatId) {
    console.warn('[video-codec] No playable VP09 formatId available');
    return;
  }

  console.info(`[video-codec] Selecting VP09 formatId ${formatId}`);
  this.player.setPlaybackQualityRange('highres', 'highres', formatId);
}

function handleNewVideo(this: PlayerManager, _: EventMap['newVideo']) {
  if (!shouldForce()) return;

  this.removeEventListener('playbackStart', setVp09PlaybackFormat);
  this.addEventListener('playbackStart', setVp09PlaybackFormat);
}

void getPlayerManager().then((playerManager) => {
  playerManager.addEventListener('newVideo', handleNewVideo);
});
