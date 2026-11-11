function isPrimitive(
  value: unknown
): value is string | number | boolean | null | undefined | symbol | bigint {
  return Object(value) !== value;
}

const originalStringify = JSON.stringify;

type FunctionReplacer = (this: any, key: string, value: any) => any;
type WhitelistReplacer = (string | number)[] | null;

/**
 * Returns a copy of `value` with `isInlinePlaybackNoAd` set, or `value` itself
 * if it has no playback context.
 *
 * Only the objects along the path are shallow-copied, since the originals may
 * be frozen. A deep `structuredClone` is not used because it throws on values
 * `JSON.stringify` accepts (functions, symbols, `toJSON` methods, ...), which
 * would break the player request and leave the video stuck loading.
 */
function withNoAdContext(value: object): object {
  // @ts-expect-error TS doesn't allow optional chaining on `unknown`. See: https://github.com/microsoft/TypeScript/issues/37700
  const playbackContext = value?.playbackContext as unknown;
  if (isPrimitive(playbackContext)) return value;

  const ctx = (playbackContext as Record<string, unknown>)
    .contentPlaybackContext;
  if (isPrimitive(ctx)) return value;

  console.info(`[JSON.stringify] Set isInlinePlaybackNoAd`);

  return {
    ...value,
    playbackContext: {
      ...playbackContext,
      contentPlaybackContext: { ...ctx, isInlinePlaybackNoAd: true }
    }
  };
}

function stringify(
  value: unknown,
  replacer?: FunctionReplacer | WhitelistReplacer,
  space?: string | number
): string {
  if (!isPrimitive(value)) {
    // TODO: add below to a dump-level logger
    // console.debug('JSON.stringify', value, replacer, space);

    try {
      value = withNoAdContext(value);
    } catch (err) {
      console.warn('[JSON.stringify] Failed to patch playback context', err);
    }
  }

  return originalStringify(value, replacer as any, space);
}

JSON.stringify = stringify;
