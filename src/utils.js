const CONTENT_INTENT_REGEX = /^.+(?=Content)/g;

export function extractLaunchParams() {
  if (window.launchParams) {
    return JSON.parse(window.launchParams);
  } else {
    return {};
  }
}

function getYTURL() {
  const ytURL = new URL('https://www.youtube.com/tv#/');
  ytURL.searchParams.append('env_forceFullAnimation', '1');
  ytURL.searchParams.append('env_enableWebSpeech', '1');
  ytURL.searchParams.append('env_enableVoice', '1');
  return ytURL;
}

/**
 * Creates a new URLSearchPrams with the contents of `a` and `b`
 * @param {URLSearchParams} a
 * @param {URLSearchParams} b
 * @returns {URLSearchParams}
 */
function concatSearchParams(a, b) {
  return new URLSearchParams([...a.entries(), ...b.entries()]);
}

export function handleLaunch(params) {
  console.info('handleLaunch', params);
  let ytURL = getYTURL();

  // We use our custom "target" param, since launches with "contentTarget"
  // parameter do not respect "handlesRelaunch" appinfo option. We still
  // fallback to "contentTarget" if our custom param is not specified.
  //
  let { target, contentTarget = target } = params;

  /** TODO: Handle google assistant
   * Sample: {contentTarget: "v=v=<ID>", storeCaller: "voice", subReason: "voiceAgent", voiceEngine: "googleAssistant"}
   */

  switch (typeof contentTarget) {
    case 'string': {
      if (contentTarget.indexOf(ytURL.origin) === 0) {
        console.info('Launching from direct contentTarget');
        ytURL = contentTarget;
      } else {
        // Out of app dial launch with second screen on home: { contentTarget: 'pairingCode=<UUID>&theme=cl&dialLaunch=watch' }
        console.info('Launching from partial contentTarget');
        if (contentTarget.indexOf('v=v=') === 0)
          contentTarget = contentTarget.substring(2);

        ytURL.search = concatSearchParams(
          ytURL.searchParams,
          new URLSearchParams(contentTarget)
        );
      }
      break;
    }
    case 'object': {
      console.info('Voice launch');

      const { intent, intentParam } = contentTarget;
      // Ctrl+F tvhtml5LaunchUrlComponentChanged & REQUEST_ORIGIN_GOOGLE_ASSISTANT in base.js for info
      const search = ytURL.searchParams;
      // contentTarget.intent's seen so far: PlayContent, SearchContent
      const voiceContentIntent = intent
        .match(CONTENT_INTENT_REGEX)?.[0]
        ?.toLowerCase();

      search.set('inApp', true);
      search.set('vs', 9); // Voice System is VOICE_SYSTEM_LG_THINKQ
      voiceContentIntent && search.set('va', voiceContentIntent);

      // order is important
      search.append('launch', 'voice');
      voiceContentIntent === 'search' && search.append('launch', 'search');

      search.set('vq', intentParam);
      break;
    }
    default: {
      console.info('Default launch');
    }
  }

  window.location.href = ytURL.toString();
}

/**
 * Wait for a child element to be added for which a predicate is true.
 *
 * When `observeAttributes` is false, the predicate is checked only when a node
 * is first added. If you want the predicate to run every time an attribute is
 * modified, set `observeAttributes` to true.
 * @template {Node} T
 * @param {Element} parent Root of tree to watch
 * @param {(node: Node) => node is T} predicate Function that checks whether its argument is the desired element
 * @param {boolean} observeAttributes Also run predicate on attribute changes
 * @param {AbortSignal=} abortSignal Signal that can be used to stop waiting
 * @return {Promise<T>} Matched element
 */
export async function waitForChildAdd(
  parent,
  predicate,
  observeAttributes,
  abortSignal
) {
  return new Promise((resolve, reject) => {
    const obs = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        switch (mut.type) {
          case 'attributes': {
            if (predicate(mut.target)) {
              obs.disconnect();
              resolve(mut.target);
              return;
            }
            break;
          }
          case 'childList': {
            for (const node of mut.addedNodes) {
              if (predicate(node)) {
                obs.disconnect();
                resolve(node);
                return;
              }
            }
            break;
          }
        }
      }
    });

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        obs.disconnect();
        reject(new Error('aborted'));
      });
    }

    obs.observe(parent, {
      subtree: true,
      attributes: observeAttributes,
      childList: true
    });
  });
}
