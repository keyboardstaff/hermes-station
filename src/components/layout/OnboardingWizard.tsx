import { useState } from "react";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { useThemeStore } from "@/store/app";
import Button from "@/components/ui/Button";
import HermesMark from "@/components/ui/HermesMark";
import SkinSelector from "@/components/settings/SkinSelector";
import FontSizeSelector from "@/components/settings/FontSizeSelector";

/**
 * First-run setup wizard (SetupGuard renders it when auth-status reports
 * needsOnboarding). Steps: welcome → account (login name + optional password)
 * → appearance → language → finish. Submitting POSTs /api/onboarding which
 * persists the name, optional password and the `onboarded` flag, then
 * SetupGuard re-checks auth-status and reveals the app. Skippable — localhost
 * is trusted, so a password isn't forced.
 */
const MIN_PW = 8;

export default function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const o = t.onboarding;
  const { theme, setTheme } = useThemeStore();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const steps = [o.stepWelcome, o.stepAccount, o.stepAppearance, o.stepLanguage];
  const last = steps.length - 1;

  const accountValid =
    !password || (password.length >= MIN_PW && password === confirm);

  const finish = async (skip: boolean) => {
    setBusy(true);
    setError("");
    try {
      const body = skip
        ? {}
        : { user_name: name.trim() || undefined, password: password || undefined };
      await api.json("/api/onboarding", "POST", body);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ? JSON.stringify(err.detail) : err.message) : (err as Error).message);
      setBusy(false);
    }
  };

  const next = () => {
    if (step === 1 && !accountValid) {
      setError(password.length < MIN_PW ? o.pwTooShort : o.pwMismatch);
      return;
    }
    setError("");
    if (step < last) setStep((s) => s + 1);
    else void finish(false);
  };

  return (
    <div className="hms-auth-root">
      <div className="hms-onboard-card">
        <header className="hms-onboard-head">
          <HermesMark size={40} />
          <div className="hms-onboard-dots">
            {steps.map((_, i) => (
              <span key={i} className="hms-onboard-dot" data-active={i === step || undefined} data-done={i < step || undefined} />
            ))}
          </div>
        </header>

        <div className="hms-onboard-body">
          {step === 0 && (
            <div className="hms-onboard-step">
              <h2 className="hms-onboard-title">{o.welcomeTitle}</h2>
              <p className="hms-onboard-text">{o.welcomeBody}</p>
            </div>
          )}

          {step === 1 && (
            <div className="hms-onboard-step">
              <h2 className="hms-onboard-title">{o.accountTitle}</h2>
              <label className="hms-onboard-label">{o.loginName}</label>
              <input
                className="hms-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={o.loginNamePlaceholder}
                maxLength={64}
                autoFocus
              />
              <label className="hms-onboard-label">{o.password} <span className="hms-onboard-optional">{o.optional}</span></label>
              <input
                className="hms-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={o.passwordPlaceholder}
              />
              {password && (
                <input
                  className="hms-input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={o.confirmPlaceholder}
                />
              )}
              <p className="hms-onboard-hint">{o.passwordHint}</p>
            </div>
          )}

          {step === 2 && (
            <div className="hms-onboard-step">
              <h2 className="hms-onboard-title">{o.appearanceTitle}</h2>
              <label className="hms-onboard-label">{t.theme.sectionLabel}</label>
              <div className="hms-onboard-themes">
                {(["light", "dark", "system"] as const).map((th) => (
                  <button
                    key={th}
                    type="button"
                    className="hms-onboard-theme"
                    data-active={theme === th || undefined}
                    onClick={() => setTheme(th)}
                  >
                    {th === "light" ? t.theme.light : th === "dark" ? t.theme.dark : t.theme.system}
                  </button>
                ))}
              </div>
              <SkinSelector />
              <FontSizeSelector />
            </div>
          )}

          {step === 3 && (
            <div className="hms-onboard-step">
              <h2 className="hms-onboard-title">{o.languageTitle}</h2>
              <div className="hms-onboard-themes">
                {(["en", "zh"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    className="hms-onboard-theme"
                    data-active={locale === l || undefined}
                    onClick={() => setLocale(l)}
                  >
                    {l === "en" ? "English" : "中文"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="hms-onboard-error">{error}</div>}
        </div>

        <footer className="hms-onboard-foot">
          <button type="button" className="hms-onboard-skip" onClick={() => void finish(true)} disabled={busy}>
            {o.skip}
          </button>
          <div className="hms-onboard-nav">
            {step > 0 && (
              <Button size="sm" onClick={() => { setError(""); setStep((s) => s - 1); }} disabled={busy}>
                <ArrowLeft size={13} /> {o.back}
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={next} disabled={busy}>
              {step < last ? <>{o.next} <ArrowRight size={13} /></> : <><Check size={13} /> {o.finish}</>}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
