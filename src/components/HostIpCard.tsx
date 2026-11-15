import { Check, Copy, Monitor, Smartphone, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../app/context";
import { useI18n } from "../hooks/i18n";
import { copyText, useToast } from "./ui";

/** The address to enter as "Host PC IP" in the TV's Developer Mode — this device's own. */
export function HostIpCard({ framed = false }: { framed?: boolean }) {
  const { t } = useI18n();
  const { hostIp, info } = useApp();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const id = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(id); }, [copied]);
  const Icon = info.mobile ? Smartphone : Monitor;
  return (
    <div className={`@container rounded-[14px] ${framed ? "panel p-4" : "bg-fill p-3.5"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex min-w-0 flex-[1_1_12rem] items-start gap-3">
          <Icon size={18} className="mt-px shrink-0 text-muted" aria-hidden />
          <div className="min-w-0">
            <p className="text-small font-semibold">{t("hostIpTitle")}</p>
            <p className="text-caption text-muted">{info.mobile ? t("hostIpBodyPhone") : t("hostIpBodyPc")}</p>
          </div>
        </div>
        {hostIp ? (
          <button type="button" onClick={() => void copyText(hostIp).then((ok) => { if (ok) { setCopied(true); toast("ok", t("copied")); } })} aria-label={`${t("copy")}: ${hostIp}`}
            className="selectable data inline-flex min-h-11 items-center gap-2.5 rounded-control bg-surface px-3.5 text-title font-semibold tracking-[0.01em] shadow-raised transition-transform duration-150 hover:bg-raised active:scale-[0.97]">
            {hostIp}{copied ? <Check size={15} className="text-ok" aria-hidden /> : <Copy size={15} className="text-muted" aria-hidden />}
          </button>
        ) : (
          <p className="flex items-start gap-2 text-small text-warn"><WifiOff size={15} className="mt-[3px] shrink-0" aria-hidden />{info.mobile ? t("hostIpNonePhone") : t("hostIpNonePc")}</p>
        )}
      </div>
    </div>
  );
}
