const CONFIG_KEY = 'ytaf-configuration';

const configOptions = new Map([
  ['enableAdBlock', { default: true, desc: 'Enable ad blocking' }],
  ['upgradeThumbnails', { default: false, desc: 'Upgrade thumbnail quality' }],
  ['removeShorts', { default: true, desc: 'Remove Shorts from subscriptions' }],
  ['enableSponsorBlock', { default: true, desc: 'Enable SponsorBlock' }],
  [
    'enableSponsorBlockSponsor',
    { default: true, desc: 'Skip sponsor segments' }
  ],
  ['enableSponsorBlockIntro', { default: true, desc: 'Skip intro segments' }],
  ['enableSponsorBlockOutro', { default: true, desc: 'Skip outro segments' }],
  [
    'enableSponsorBlockInteraction',
    {
      default: true,
      desc: 'Skip interaction reminder segments'
    }
  ],
  [
    'enableSponsorBlockSelfPromo',
    {
      default: true,
      desc: 'Skip self promotion segments'
    }
  ],
  [
    'enableSponsorBlockMusicOfftopic',
    {
      default: true,
      desc: 'Skip non-music segments in music videos'
    }
  ],
  [
    'hideLogo',
    {
      default: false,
      desc: 'Hide YouTube logo'
    }
  ]
]);

const defaultConfig = (() => {
  let ret = {};
  for (const [k, v] of configOptions) {
    ret[k] = v.default;
  }
  return ret;
})();

/** @type {Record<string, DocumentFragment>} as const */
const configFrags = (() => {
  let ret = {};
  for (const k of configOptions.keys()) {
    ret[k] = new DocumentFragment();
  }
  return ret;
})();

function loadStoredConfig() {
  const storage = window.localStorage.getItem(CONFIG_KEY);

  if (storage === null) {
    console.info('Config not set; using defaults.');
    return null;
  }

  try {
    return JSON.parse(storage);
  } catch (err) {
    console.warn('Error parsing stored config:', err);
    return null;
  }
}

// Use defaultConfig as a prototype so writes to localConfig don't change it.
let localConfig = loadStoredConfig() ?? Object.create(defaultConfig);

function configExists(key) {
  return configOptions.has(key);
}

export function configGetDesc(key) {
  if (!configExists(key)) {
    throw new Error('tried to get desc for unknown config key: ' + key);
  }

  return configOptions.get(key).desc;
}

export function configRead(key) {
  if (!configExists(key)) {
    throw new Error('tried to read unknown config key: ' + key);
  }

  if (localConfig[key] === undefined) {
    console.warn(
      'Populating key',
      key,
      'with default value',
      defaultConfig[key]
    );

    localConfig[key] = defaultConfig[key];
  }

  return localConfig[key];
}

export function configWrite(key, value) {
  if (!configExists(key)) {
    throw new Error('tried to write unknown config key: ' + key);
  }

  const oldValue =
    localConfig[key] !== undefined ? localConfig[key] : defaultConfig[key];

  console.info('Changing key', key, 'from', oldValue, 'to', value);
  localConfig[key] = value;
  window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);

  configFrags[key].dispatchEvent(
    new CustomEvent('ytafConfigChange', {
      detail: { key, newValue: value, oldValue }
    })
  );
}

/**
 * Add a listener for changes in the value of a specified config option
 * @param {string} key Config option to monitor
 * @param {(evt: Event) => void} callback Function to be called on change
 */
export function configAddChangeListener(key, callback) {
  const frag = configFrags[key];

  frag.addEventListener('ytafConfigChange', callback);
}

/**
 * Remove a listener for changes in the value of a specified config option
 * @param {string} key Config option to monitor
 * @param {(evt: Event) => void} callback Function to be called on change
 */
export function configRemoveChangeListener(key, callback) {
  const frag = configFrags[key];

  frag.removeEventListener('ytafConfigChange', callback);
}
