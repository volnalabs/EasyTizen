import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../app/context";
import { copyText, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";

/** Step-by-step Developer Mode instructions, with this device's address filled in. */
export function DevModeGuide() {
  const { t } = useI18n();
  const { info, hostIp } = useApp();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const id = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(id); }, [copied]);
  const steps: Key[] = ["devStep1", "devStep2", "devStep3", "devStep4", "devStep5"];
  return (
    <div>
      <ol className="m-0 list-none space-y-4 p-0">
        {steps.map((key, i) => (
          <li key={key} className="flex gap-3.5">
            <span className="data grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-small font-semibold text-accent-text" aria-hidden>{i + 1}</span>
            <div className="min-w-0 flex-1 pt-[3px]">
              <p>{t(key)}</p>
              {key === "devStep4" && (
                hostIp ? (
                  <>
                    <button type="button" onClick={() => void copyText(hostIp).then((ok) => { if (ok) { setCopied(true); toast("ok", t("copied")); } })} aria-label={`${t("copy")}: ${hostIp}`}
                      className="selectable data mt-2.5 inline-flex min-h-12 items-center gap-3 rounded-control bg-fill px-4 text-title font-semibold tracking-[0.01em] transition-[background-color,transform] duration-150 hover:bg-fill-2 active:scale-[0.97]">
                      {hostIp}{copied ? <Check size={16} className="text-ok" aria-hidden /> : <Copy size={16} className="text-muted" aria-hidden />}
                    </button>
                    <p className="mt-2 text-small text-muted">{info.mobile ? t("devHostPhone") : t("devHostPc")}</p>
                  </>
                ) : <p className="mt-1 text-small text-warn">{t("devNoIp")}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-line pt-4 text-small text-muted">{t("devNote")}</p>
    </div>
  );
}
