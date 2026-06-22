function isPrimitive(
  value: unknown
): value is string | number | boolean | null | undefined | symbol | bigint {
  return Object(value) !== value;
}

const originalStringify = JSON.stringify;

type FunctionReplacer = (this: any, key: string, value: any) => any;
type WhitelistReplacer = (string | number)[] | null;

function stringify(
  value: unknown,
  replacer?: FunctionReplacer | WhitelistReplacer,
  space?: string | number
): string {
  if (!isPrimitive(value)) {
    // TODO: add below to a dump-level logger
    // console.debug('JSON.stringify', value, replacer, space);

    const holder = value as Record<string, any>;
    const pbCtx = holder.playbackContext as Record<string, any> | undefined;
    const ctx = pbCtx?.contentPlaybackContext as
      | Record<string, unknown>
      | undefined;

    if (!isPrimitive(ctx) && ctx!.isInlinePlaybackNoAd !== true) {
      // Setting `isInlinePlaybackNoAd` tells InnerTube not to serve ads, which
      // avoids the server-side SABR "backoff" that otherwise stalls playback
      // after a few seconds. YouTube has shipped a "locker" script that defines
      // this property as non-writable/non-configurable via Object.defineProperty,
      // so a direct assignment (`ctx.isInlinePlaybackNoAd = true`) silently fails.
      //
      // Instead of mutating YouTube's object in place, rebuild the holder chain
      // with fresh plain objects. `JSON.stringify` only serializes own enumerable
      // properties, so spreading reproduces exactly what would be serialized while
      // dropping any locked property descriptors, letting our flag stick.
      value = {
        ...holder,
        playbackContext: {
          ...pbCtx,
          contentPlaybackContext: {
            ...ctx,
            isInlinePlaybackNoAd: true
          }
        }
      };
      console.info(`[JSON.stringify] Set isInlinePlaybackNoAd`);
    }
  }

  return originalStringify(value, replacer as any, space);
}

JSON.stringify = stringify;
