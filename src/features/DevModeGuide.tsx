import { Copy } from "lucide-react";
import { useApp } from "../app/context";
import { copyText, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";

/** Step-by-step Developer Mode instructions, with this device's address filled in. */
export function DevModeGuide() {
  const { t } = useI18n();
  const { info } = useApp();
  const toast = useToast();
  const steps: Key[] = ["devStep1", "devStep2", "devStep3", "devStep4", "devStep5"];
  return (
    <div>
      <ol className="m-0 list-none space-y-3.5 p-0">
        {steps.map((key, i) => (
          <li key={key} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-caption font-semibold text-accent-text" aria-hidden>{i + 1}</span>
            <div className="min-w-0 flex-1 pt-px">
              <p>{t(key)}</p>
              {key === "devStep4" && (
                info.host_ip ? (
                  <button type="button" onClick={() => copyText(info.host_ip!).then((ok) => ok && toast("ok", t("copied")))} aria-label={`${t("copy")}: ${info.host_ip}`}
                    className="selectable data mt-2 inline-flex min-h-11 items-center gap-3 rounded-[10px] border border-line-strong bg-surface-2 px-3.5 py-2 text-title font-semibold tracking-wide transition-colors hover:bg-surface-3">
                    {info.host_ip}<Copy size={15} className="text-muted" aria-hidden />
                  </button>
                ) : <p className="mt-1 text-warn">{t("devNoIp")}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-line pt-3 text-small text-muted">{t("devNote")}</p>
    </div>
  );
}
