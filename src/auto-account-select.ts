import { configRead } from './config';

import { ResolveCommandRegistry, type ResolveCommandHook } from './app_api';

const registry = await ResolveCommandRegistry.getInstance();

const hook: ResolveCommandHook = function (resolveCommand, payload, extra) {
  if (!configRead('autoAccountSelect')) {
    resolveCommand(payload, extra);
    return;
  }

  const finalEndpoint = payload?.startAccountSelectorCommand // @ts-expect-error TS doesn't allow optional chaining on `unknown`. See: github.com/microsoft/TypeScript/issues/37700
    ?.nextEndpoint as unknown;

  registry.dispatchCommand({
    onIdentityChanged: {
      identityActionContext: {
        nextEndpoint: finalEndpoint,
        eventTrigger: 'ACCOUNT_EVENT_TRIGGER_WHOS_WATCHING',
        reloadRequired: undefined
      },
      isSameIdentity: true
    },
    commandMetadata: { webCommandMetadata: { clientAction: true } }
  });
};

registry.setHook('startAccountSelectorCommand', hook);
