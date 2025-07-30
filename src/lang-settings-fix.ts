// Adapted from https://github.com/reisxd/TizenTube/blob/522f83cc012d5b1c75181b651e084a3afa280323/mods/resolveCommand.js

import {
  ResolveCommandRegistry,
  type ResolveCommandHook
} from './app_api/index';

function getPrefsCookie() {
  const PREFIX = 'PREF=';

  let str = document.cookie.split('; ').find((x) => x.startsWith(PREFIX));
  if (!str) return new URLSearchParams();

  str = str.slice(PREFIX.length);
  return new URLSearchParams(str);
}

const hook: ResolveCommandHook = function (resolveCommand, payload, extra) {
  const passthrough = () => {
    console.warn(
      `[lang-settings-fix] Passing through due to payload mismatch."`
    );
    return resolveCommand(payload, extra);
  };

  if (
    !payload.setClientSettingEndpoint ||
    typeof payload.setClientSettingEndpoint !== 'object'
  )
    return passthrough();

  const setClientSettingEndpoint = payload.setClientSettingEndpoint as Record<
    string,
    unknown
  >;

  if (!Array.isArray(setClientSettingEndpoint.settingDatas))
    return passthrough();

  const idx = setClientSettingEndpoint.settingDatas.findIndex(
    (setting) => setting.clientSettingEnum?.item === 'I18N_LANGUAGE'
  );

  if (idx === -1) return resolveCommand(payload, extra);

  const setting = setClientSettingEndpoint.settingDatas[idx];

  const lang = setting.stringValue;
  const date = new Date();
  date.setFullYear(date.getFullYear() + 10);

  const prefs = getPrefsCookie();
  prefs.set('hl', lang);
  document.cookie = `PREF=${prefs.toString()}; Domain=.youtube.com; expires=${date.toUTCString()};`;

  resolveCommand({
    signalAction: {
      signal: 'RELOAD_PAGE'
    }
  });

  return true;
};

const registry = await ResolveCommandRegistry.getInstance();
registry.setHook('setClientSettingEndpoint', hook);
