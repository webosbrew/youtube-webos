// Adapted from https://github.com/reisxd/TizenTube/blob/522f83cc012d5b1c75181b651e084a3afa280323/mods/resolveCommand.js

declare global {
  interface Window {
    _yttv?: Record<string, unknown>;
  }
}

export type ResolveCommandPayload = Record<string, unknown>;

interface ResolveCommand {
  (command: ResolveCommandPayload, extra?: unknown): unknown;
}

export interface ResolveCommandHook {
  (
    originalFn: ResolveCommand,
    payload: ResolveCommandPayload,
    extra: unknown
  ): unknown;
}

let registry: ResolveCommandRegistry | null = null;

export class ResolveCommandRegistry {
  #originalFn: ResolveCommand;
  #cmds = new Map<string, ResolveCommandHook>();

  private resolveCommand = (
    command: Record<string, unknown>,
    extra?: unknown
  ) => {
    console.group(`[${this.constructor.name}] Resolving`);
    console.debug(`Command:`);
    console.debug(command);
    console.debug(`Extra:`);
    console.debug(extra);
    console.groupEnd();

    for (const key of Object.keys(command)) {
      if (this.#cmds.has(key)) {
        return this.#cmds.get(key)!(this.#originalFn, command, extra);
      }
    }

    return this.#originalFn(command, extra);
  };

  private constructor(hookTargetName: string) {
    if (!ResolveCommandRegistry.checkHookTarget(hookTargetName)) {
      throw new Error(
        `Hook target "${hookTargetName}" not found in window._yttv`
      );
    }

    const hookTarget = window._yttv![hookTargetName] as {
      instance: { resolveCommand: ResolveCommand };
    };

    this.#originalFn = hookTarget.instance.resolveCommand.bind(
      hookTarget.instance
    );

    hookTarget.instance.resolveCommand = this.resolveCommand;

    console.debug(`[${this.constructor.name}] Hooked:`, this.#originalFn);
  }

  private static checkHookTarget(targetName: string) {
    const target = window._yttv?.[targetName];

    return !!(
      target &&
      typeof target === 'function' &&
      'instance' in target &&
      typeof target.instance === 'object' &&
      typeof (target.instance as Record<string, unknown>).resolveCommand ===
        'function'
    );
  }

  private static findHookTarget() {
    if (typeof window?._yttv !== 'object') return null;

    for (const key in window._yttv) {
      if (this.checkHookTarget(key)) {
        return key;
      }
    }

    return null;
  }

  private static async getHookTarget(): Promise<string> {
    let hook = this.findHookTarget();

    if (hook) return hook;

    return new Promise((resolve) => {
      const poll = () => {
        hook = this.findHookTarget();
        if (hook) {
          resolve(hook);
        } else {
          setTimeout(poll, 0);
        }
      };
      poll();
    });
  }

  static async getInstance() {
    if (registry) return registry;

    const key = await this.getHookTarget();

    registry = registry ?? new ResolveCommandRegistry(key);
    return registry;
  }

  setHook(command: string, fn: ResolveCommandHook) {
    this.#cmds.set(command, fn);
  }

  removeHook(command: string) {
    this.#cmds.delete(command);
  }

  dispatchCommand(payload: ResolveCommandPayload, extra?: unknown) {
    return this.#originalFn(payload, extra);
  }
}

ResolveCommandRegistry.getInstance();
