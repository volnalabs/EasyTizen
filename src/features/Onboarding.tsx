import { ArrowLeft, ArrowRight, FileArchive, Rocket, Smartphone, Tv2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../app/context";
import { HostIpCard } from "../components/HostIpCard";
import { Logo } from "../components/Logo";
import { Button, Segmented } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { api } from "../services/api";
import { DevModeGuide } from "./DevModeGuide";

/** First run, two screens: what EasyTizen does (and the language) → preparing the TV once. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { info, settings, refresh } = useApp();
  const steps = ["welcome", "tv"] as const;
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const finish = async () => { await api.completeOnboarding(); await refresh(); onDone(); };
  const setLanguage = async (language: "auto" | "ru" | "en") => {
    await api.savePreferences({ theme: settings.theme, language, default_port: settings.default_port, timeout_ms: settings.timeout_ms, check_updates: settings.check_updates });
    await refresh();
  };
  const flow = [[Tv2, t("obPoint1")], [FileArchive, t("obPoint2")], [Rocket, t("obPoint3")]] as const;

  return (
    <div className="fade-in safe-top safe-bottom safe-x fixed inset-0 z-30 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={t("obWelcome")}>
      <div className="flex min-h-14 items-center gap-3 px-4 sm:px-8">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">{index > 0 && <><Logo size={26} /><span className="font-semibold tracking-[-0.01em]">EasyTizen</span></>}</span>
        <span className="sr-only">{t("stepOf", { n: index + 1, total: steps.length })}</span>
        <div className="flex items-center gap-1.5" aria-hidden>
          {steps.map((s, i) => <span key={s} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-6 bg-accent" : "w-1.5 bg-fill-3"}`} />)}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void finish()}>{t("skip")}</Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-8">
        <div key={step} className="page-in mx-auto w-full max-w-[32rem] py-6 sm:py-12">
          {step === "welcome" && (
            <div>
              <div className="flex flex-col items-center text-center">
                <Logo size={80} />
                <h1 className="mt-7 text-display font-semibold tracking-[-0.035em]">{t("obWelcome")}</h1>
                <p className="mt-3 max-w-[34ch] text-emph text-muted">{t("obWelcomeBody")}</p>
              </div>
              <ol className="m-0 mt-9 list-none space-y-0 p-0">
                {flow.map(([Icon, text], i) => (
                  <li key={text} className="relative flex items-center gap-4 py-2.5">
                    {i < flow.length - 1 && <span aria-hidden className="absolute start-5 top-[calc(50%+1.25rem)] h-[calc(100%-2.5rem)] w-0.5 rounded-full bg-fill-2" />}
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-surface text-accent-text shadow-raised"><Icon size={19} aria-hidden /></span>
                    <span className="min-w-0 font-medium">{text}</span>
                  </li>
                ))}
              </ol>
              {info.mobile && <p className="mt-5 flex items-start gap-2.5 rounded-control bg-ok-soft px-3.5 py-3 text-small"><Smartphone size={16} className="mt-px shrink-0 text-ok" aria-hidden /><span className="min-w-0">{t("obAndroidNote")}</span></p>}
              <div className="mt-8">
                <p className="mb-2 text-small font-semibold">{t("language")}</p>
                <Segmented stretch label={t("language")} value={settings.language} onChange={(v) => void setLanguage(v)} options={[{ value: "auto", label: t("langAuto") }, { value: "ru", label: "Русский" }, { value: "en", label: "English" }]} />
              </div>
            </div>
          )}
          {step === "tv" && (
            <div className="space-y-5">
              <div>
                <h1 className="text-heading font-semibold tracking-[-0.025em]">{t("obTvTitle")}</h1>
                <p className="mt-2 text-muted">{t("obTvBody")}</p>
              </div>
              <HostIpCard framed />
              <div className="panel p-4 sm:p-5"><DevModeGuide /></div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[32rem] items-center gap-2 px-5 py-3 sm:px-0">
          {index > 0 && <Button variant="ghost" onClick={() => setIndex(index - 1)} icon={<ArrowLeft size={16} aria-hidden />}>{t("back")}</Button>}
          <Button variant="primary" size="lg" className="ms-auto flex-[1_1_auto] sm:flex-none" onClick={() => (index === steps.length - 1 ? void finish() : setIndex(index + 1))}>
            {index === steps.length - 1 ? t("obStart") : t("next")}<ArrowRight size={18} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
