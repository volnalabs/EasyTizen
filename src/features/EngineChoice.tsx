import { Check, Cpu, PackageCheck } from "lucide-react";
import { useApp } from "../app/context";
import { Pill } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { api } from "../services/api";
import type { Engine } from "../types";

/** Desktop only: official Samsung tools or EasyTizen's built-in engine. */
export function EngineChoice() {
  const { t } = useI18n();
  const { settings, refresh, reloadTool, setTv } = useApp();
  const choose = async (engine: Engine) => {
    if (engine === settings.engine) return;
    await api.setEngine(engine);
    setTv(null);
    await refresh();
    reloadTool();
  };
  const options: { engine: Engine; icon: typeof Cpu; title: string; body: string; tag: string; tone: "ok" | "warn" }[] = [
    { engine: "sdk", icon: PackageCheck, title: t("engineSdk"), body: t("engineSdkBody"), tag: t("engineRecommended"), tone: "ok" },
    { engine: "builtin", icon: Cpu, title: t("engineBuiltin"), body: t("engineBuiltinBody"), tag: t("engineExperimental"), tone: "warn" },
  ];
  return (
    <div>
      <div role="radiogroup" aria-label={t("engineTitle")} className="grid gap-3 sm:grid-cols-2">
        {options.map(({ engine, icon: Icon, title, body, tag, tone }) => {
          const active = settings.engine === engine;
          return (
            <button key={engine} type="button" role="radio" aria-checked={active} onClick={() => void choose(engine)}
              className={`relative flex flex-col items-start rounded-[12px] border p-4 text-left transition-[background-color,border-color,box-shadow] ${active ? "border-accent bg-accent-soft shadow-[0_0_0_1px_var(--accent)]" : "border-line-strong bg-surface hover:bg-surface-2"}`}>
              <div className="flex w-full items-center gap-2.5">
                <Icon size={18} className={`shrink-0 ${active ? "text-accent-text" : "text-muted"}`} aria-hidden />
                <span className="min-w-0 flex-1 font-semibold">{title}</span>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`} aria-hidden>{active && <Check size={12} strokeWidth={3} />}</span>
              </div>
              <div className="mt-2"><Pill tone={tone}>{tag}</Pill></div>
              <p className="mt-2 text-small text-muted">{body}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-small text-muted">{t("engineNote")}</p>
    </div>
  );
}
