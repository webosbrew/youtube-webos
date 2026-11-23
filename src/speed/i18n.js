/**
 * The few strings of the playback-speed UI, in the TV's language when there is
 * a translation (English otherwise).
 */
const STRINGS = {
  en: {
    changingTo: (s) => `Changing to ${s}`,
    backToNormal: 'Back to normal',
    inSeconds: (n) => `in ${n} s`,
    speedIs: (s) => `Speed ${s}`,
    normalSpeed: 'Normal speed',
    activeNow: 'Active now',
    audioSync: 'Audio sync (playback speed)',
    earlier: 'Earlier',
    later: 'Later'
  },
  pt: {
    changingTo: (s) => `Mudando para ${s}`,
    backToNormal: 'Voltando ao normal',
    inSeconds: (n) => `em ${n} s`,
    speedIs: (s) => `Velocidade ${s}`,
    normalSpeed: 'Velocidade normal',
    activeNow: 'Ativada agora',
    audioSync: 'Sincronia do áudio (velocidade)',
    earlier: 'Adiantar',
    later: 'Atrasar'
  }
};

export function uiLanguage(
  nav = typeof navigator !== 'undefined' ? navigator : null
) {
  const lang =
    (nav && (nav.language || (nav.languages && nav.languages[0]))) || 'en';
  return String(lang).toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function strings(lang = uiLanguage()) {
  return STRINGS[lang] || STRINGS.en;
}

/** "1.5×", or "1,5×" where the decimal separator is a comma. */
export function formatSpeed(speed, lang = uiLanguage()) {
  const s = String(speed);
  return `${lang === 'pt' ? s.replace('.', ',') : s}×`;
}
