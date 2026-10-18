// Autostart can launch the app before the network is up (#326).
const PROBE_URL = 'https://www.youtube.com/generate_204';
const PROBE_TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 2000;

const enum ProbeResult {
  Reachable,
  Unreachable
}

function probe(): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () => resolve(ProbeResult.Unreachable),
      PROBE_TIMEOUT_MS
    );
    const done = (result: ProbeResult) => {
      clearTimeout(timeout);
      resolve(result);
    };

    fetch(`${PROBE_URL}?t=${Date.now()}`, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit'
    }).then(
      () => done(ProbeResult.Reachable),
      () => done(ProbeResult.Unreachable)
    );
  });
}

function showWaitingMessage(): HTMLElement {
  const message = document.createElement('p');
  message.textContent =
    'Waiting for an internet connection. YouTube will open automatically. Press OK to open it now.';
  message.style.cssText =
    'position:fixed;top:40%;left:10%;right:10%;margin:0;color:#eee;font:28px sans-serif;text-align:center';
  document.documentElement.style.background = '#111';
  (document.body ?? document.documentElement).appendChild(message);
  return message;
}

export function waitForNetwork(): Promise<void> {
  // No native fetch on webOS 3.x
  if (typeof window.fetch !== 'function') return Promise.resolve();

  return new Promise((resolve) => {
    let finished = false;
    let message: HTMLElement | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(retryTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      message?.remove();
      resolve();
    };

    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.keyCode === 13) finish();
    };

    const attempt = () => {
      void probe().then((result) => {
        if (finished) return;
        if (result === ProbeResult.Reachable) {
          finish();
          return;
        }
        if (!message) {
          console.info('YouTube unreachable, waiting for network');
          message = showWaitingMessage();
          document.addEventListener('keydown', onKeyDown, true);
        }
        retryTimer = setTimeout(attempt, RETRY_DELAY_MS);
      });
    };

    attempt();
  });
}
