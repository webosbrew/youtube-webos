export type webOSLaunchParams = Record<string, unknown>;

declare global {
  interface Window {
    launchParams?: webOSLaunchParams;
    __ytaf_debug__?: boolean;
    /** Set by YouTube's page: the home screen it fetches before the user script runs */
    pendingEarlyBrowse?: Promise<{ response?: unknown } | undefined>;
  }

  interface Document {
    addEventListener(
      eventName: 'webOSRelaunch',
      listener: (evt: CustomEvent<webOSLaunchParams>) => void,
      useCapture?: boolean
    ): void;
  }
}
