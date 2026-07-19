import { configRead } from './config';
/**
 * Makes an "English" auto-translated subtitle track selectable on the TV.
 *
 * The webOS/leanback captions menu only lists the tracks present in the
 * `/player` response's `captionTracks`. Unlike the desktop web player, it does
 * not expose the "auto-translate" submenu built from `translationLanguages`
 * (and TV responses omit that list anyway). So for a video whose captions are
 * in another language there is no way to pick English from the UI.
 *
 * We fix this by intercepting the `/player` JSON response (via the same
 * `JSON.parse` hook technique used by adblock) and injecting a synthetic
 * English track. We clone an existing caption track — preserving all of its
 * `baseUrl` query params (auth / `pot` / signature) — and add `&tlang=en`, the
 * parameter YouTube's timedtext server uses to machine-translate any track.
 * The clone then shows up as a normal, directly-selectable option named
 * "English" in the captions menu.
 */

interface CaptionTrackName {
  simpleText?: string;
  runs?: { text: string }[];
}

interface CaptionTrack {
  baseUrl: string;
  name: CaptionTrackName;
  vssId?: string;
  languageCode: string;
  kind?: string;
  rtl?: boolean;
  isTranslatable?: boolean;
  trackName?: string;
}

interface TranslationLanguage {
  languageCode: string;
  languageName?: CaptionTrackName;
}

interface AudioTrack {
  captionTrackIndices?: number[];
  defaultCaptionTrackIndex?: number;
}

interface CaptionsTracklistRenderer {
  captionTracks?: CaptionTrack[];
  audioTracks?: AudioTrack[];
  translationLanguages?: TranslationLanguage[];
}

const ENGLISH_LABEL = 'English(Auto-generated-forced)';

function isEnglish(languageCode: string | undefined) {
  return /^en\b/i.test(languageCode ?? '');
}

/** Mirror the `name` shape of the source track so the renderer stays happy. */
function makeName(source: CaptionTrackName): CaptionTrackName {
  if (source && Array.isArray(source.runs)) {
    return { runs: [{ text: ENGLISH_LABEL }] };
  }
  return { simpleText: ENGLISH_LABEL };
}

function buildTranslatedUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl, document.location.href);
    url.searchParams.set('tlang', 'en');
    return url.toString();
  } catch (err) {
    console.warn('[subtitles] Could not parse caption baseUrl', baseUrl, err);
    return null;
  }
}

function injectEnglishTrack(renderer: CaptionsTracklistRenderer) {
  const tracks = renderer.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return;

  // English (native or auto-generated) is already offered — nothing to do.
  if (tracks.some((t) => isEnglish(t.languageCode))) return;

  // Pick an existing track as the translation source and point it at YouTube's
  // machine translation. We don't gate on `translationLanguages` — TV responses
  // omit it — and `buildTranslatedUrl` preserves the source's auth query params.
  const source = tracks.find((t) => !isEnglish(t.languageCode)) ?? tracks[0];
  if (!source) return;

  const baseUrl = buildTranslatedUrl(source.baseUrl);
  if (!baseUrl) return;
  // Build a clean English track rather than spreading `...source`: the auth is
  // carried by `baseUrl`, and copying the source would drag along wrong fields
  // (e.g. `rtl: true` from an Arabic track, or `kind: "asr"`). A distinct
  // `vssId`/`languageCode` is required so the menu doesn't collapse it into the
  // source track as a duplicate.
  const newIndex =
    tracks.push({
      baseUrl,
      name: makeName(source.name),
      vssId: '.en',
      languageCode: 'en',
      isTranslatable: true,
      trackName: ENGLISH_LABEL
    }) - 1;

  // The caption menu is built from each audio track's `captionTrackIndices`,
  // not from `captionTracks` directly — so a freshly pushed track is invisible
  // until its index is registered here.
  const audioTracks = renderer.audioTracks;
  if (Array.isArray(audioTracks)) {
    for (const at of audioTracks) {
      if (
        Array.isArray(at.captionTrackIndices) &&
        !at.captionTrackIndices.includes(newIndex)
      ) {
        at.captionTrackIndices.push(newIndex);
      }
    }
  }

  console.info('[subtitles] Injected auto-translated English caption track');
}

const origParse = JSON.parse;
JSON.parse = function (this: unknown) {
  // eslint-disable-next-line prefer-rest-params
  const r = origParse.apply(this, arguments as never);

  if (!configRead('forceEnglishSubtitles')) {
    return r;
  }

  try {
    const renderer: CaptionsTracklistRenderer | undefined =
      r?.captions?.playerCaptionsTracklistRenderer;
    if (renderer) {
      injectEnglishTrack(renderer);
    }
  } catch (err) {
    console.warn('[subtitles] Failed to process captions', err);
  }

  return r;
};
