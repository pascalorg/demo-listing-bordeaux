import { COPY } from './copy.js';

const STORAGE_KEY = 'pascal-listing-language';

function getPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function storedLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return COPY[stored] ? stored : null;
  } catch {
    return null;
  }
}

function browserLanguage() {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  const french = tags.some((tag) => typeof tag === 'string' && tag.toLowerCase().startsWith('fr'));
  return french ? 'fr' : 'en';
}

export function createI18n() {
  const listeners = new Set();
  // An explicit, persisted choice always wins; otherwise follow the browser preference.
  let language = storedLanguage() ?? browserLanguage();

  function t(path) {
    return getPath(COPY[language], path) ?? path;
  }

  function formatArea(value) {
    if (!Number.isFinite(value)) return '';
    return `${new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)} m²`;
  }

  function apply(root = document) {
    document.documentElement.lang = language;
    document.title = t('meta.title');
    root.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-alt]').forEach((element) => {
      element.alt = t(element.dataset.i18nAlt);
    });
    const toggle = document.querySelector('#lang-toggle');
    if (toggle) {
      toggle.textContent = t('ui.languageToggle');
      toggle.setAttribute('aria-label', t('ui.switchLanguage'));
    }
  }

  function set(next) {
    if (!COPY[next] || next === language) return;
    language = next;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch { /* private mode: keep the choice for this session only */ }
    apply();
    listeners.forEach((listener) => listener(language));
  }

  document.querySelector('#lang-toggle')?.addEventListener('click', () => {
    set(language === 'fr' ? 'en' : 'fr');
  });

  return {
    apply,
    get language() { return language; },
    t,
    formatArea,
    dictionary() { return COPY[language]; },
    set,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
