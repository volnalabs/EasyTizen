import { ArrowLeft, ArrowRight, KeyRound, Search, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { useApp } from "../app/context";
import { Logo } from "../components/Logo";
import { Button, IconTile, Segmented } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { api } from "../services/api";
import { DevModeGuide } from "./DevModeGuide";
import { EngineChoice } from "./EngineChoice";
import { ToolsPanel } from "./Setup";

/** First-run guide: welcome → tools (desktop) → Developer Mode on the TV → done. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { info, settings, refresh } = useApp();
  const steps = info.mobile ? (["welcome", "tv", "done"] as const) : (["welcome", "tools", "tv", "done"] as const);
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const finish = async () => { await api.completeOnboarding(); await refresh(); onDone(); };
  const next = () => (index === steps.length - 1 ? void finish() : setIndex(index + 1));
  const setLanguage = async (language: "auto" | "ru" | "en") => {
    await api.savePreferences({ theme: settings.theme, language, default_port: settings.default_port, timeout_ms: settings.timeout_ms, check_updates: settings.check_updates });
    await refresh();
  };
  const points = [[Search, t("obPoint1")], [KeyRound, t("obPoint2")], [ShieldCheck, t("obPoint3")]] as const;

  return (
    <div className="fade-in safe-top safe-bottom safe-x fixed inset-0 z-30 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={t("obWelcome")}>
      <div className="flex items-center gap-3 px-5 py-3.5 sm:px-8">
        <Logo size={26} /><span className="font-semibold tracking-[-0.01em]">EasyTizen</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-caption text-muted">{t("stepOf", { n: index + 1, total: steps.length })}</span>
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((s, i) => <span key={s} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-6 bg-accent" : i < index ? "w-1.5 bg-accent" : "w-1.5 bg-surface-3"}`} />)}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-8">
        <div key={step} className="fade-up mx-auto w-full max-w-[36rem] py-6 sm:py-10">
          {step === "welcome" && (
            <div className="text-center">
              <div className="mx-auto w-fit rounded-[22px] shadow-[0_18px_40px_-14px_rgb(63_91_246/0.55)]"><Logo size={84} /></div>
              <h1 className="mt-7 text-display font-semibold tracking-[-0.02em]">{t("obWelcome")}</h1>
              <p className="mx-auto mt-3 max-w-[40ch] text-emph text-muted">{t("obWelcomeBody")}</p>
              <ul className="mx-auto mt-8 max-w-[26rem] list-none space-y-3 p-0 text-left">
                {points.map(([Icon, text]) => (
                  <li key={text} className="flex items-center gap-3.5"><IconTile size="sm"><Icon size={17} aria-hidden /></IconTile><span className="min-w-0">{text}</span></li>
                ))}
                {info.mobile && <li className="flex items-center gap-3.5"><IconTile size="sm" tone="ok"><Smartphone size={17} aria-hidden /></IconTile><span className="min-w-0">{t("obAndroidNote")}</span></li>}
              </ul>
              <div className="mx-auto mt-9 max-w-[26rem] text-left">
                <p className="mb-2 text-small font-semibold">{t("language")}</p>
                <Segmented stretch label={t("language")} value={settings.language} onChange={(v) => void setLanguage(v)} options={[{ value: "auto", label: t("langAuto") }, { value: "ru", label: "Русский" }, { value: "en", label: "English" }]} />
              </div>
            </div>
          )}
          {step === "tools" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-heading font-semibold tracking-[-0.015em]">{t("obToolsTitle")}</h1>
                <p className="mt-1.5 text-muted">{t("obToolsBody")}</p>
              </div>
              <EngineChoice />
              {settings.engine === "sdk" && <div className="card p-4 sm:p-5"><ToolsPanel /></div>}
            </div>
          )}
          {step === "tv" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-heading font-semibold tracking-[-0.015em]">{t("obTvTitle")}</h1>
                <p className="mt-1.5 text-muted">{t("obTvBody")}</p>
              </div>
              <div className="card p-4 sm:p-5"><DevModeGuide /></div>
            </div>
          )}
          {step === "done" && (
            <div className="pt-4 text-center sm:pt-10">
              <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-ok-soft text-ok">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
              <h1 className="mt-6 text-display font-semibold tracking-[-0.02em]">{t("obDoneTitle")}</h1>
              <p className="mx-auto mt-3 max-w-[40ch] text-emph text-muted">{t("obDoneBody")}</p>
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[36rem] items-center gap-2 px-5 py-3 sm:px-0">
          {index > 0
            ? <Button variant="ghost" onClick={() => setIndex(index - 1)}><ArrowLeft size={16} aria-hidden />{t("back")}</Button>
            : <Button variant="ghost" onClick={() => void finish()}>{t("skip")}</Button>}
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {step === "tools" && <Button variant="ghost" onClick={next}>{t("obLater")}</Button>}
            <Button variant="primary" onClick={next}>{index === steps.length - 1 ? t("obStart") : t("next")}<ArrowRight size={16} aria-hidden /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}
