import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Locale, Translations } from "./types.js";
import { en } from "./en.js";
import { zh } from "./zh.js";

const TRANSLATIONS: Record<Locale, Translations> = { en, zh };

const STORAGE_KEY = "hms_locale";

interface I18nContextValue {
  t: Translations;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  t: en,
  locale: "en",
  setLocale: () => {},
});

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    /* SSR / private browsing */
  }
  // Detect browser language
  const lang = navigator.language.startsWith("zh") ? "zh" : "en";
  return lang;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <I18nContext.Provider value={{ t: TRANSLATIONS[locale], locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
