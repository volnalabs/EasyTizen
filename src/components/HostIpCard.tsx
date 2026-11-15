import { Copy, Smartphone, Monitor } from "lucide-react";
import { useApp } from "../app/context";
import { useI18n } from "../hooks/i18n";
import { copyText, useToast } from "./ui";

/** The address to enter as "Host PC IP" in the TV's Developer Mode — this device's own. */
export function HostIpCard({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { hostIp, info } = useApp();
  const toast = useToast();
  const Icon = info.mobile ? Smartphone : Monitor;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-line bg-surface-2/60 ${compact ? "px-3 py-2.5" : "p-3.5"}`}>
      <Icon size={18} className="shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-[1_1_12rem]">
        <p className="text-small font-semibold">{t("hostIpTitle")}</p>
        {!compact && <p className="text-caption text-muted">{info.mobile ? t("hostIpBodyPhone") : t("hostIpBodyPc")}</p>}
      </div>
      {hostIp ? (
        <button type="button" onClick={() => copyText(hostIp).then((ok) => ok && toast("ok", t("copied")))} aria-label={`${t("copy")}: ${hostIp}`}
          className="selectable data inline-flex min-h-10 items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3 py-1.5 text-emph font-semibold tracking-wide transition-colors hover:bg-surface-3">
          {hostIp}<Copy size={14} className="text-muted" aria-hidden />
        </button>
      ) : <p className="text-small text-warn">{info.mobile ? t("hostIpNonePhone") : t("hostIpNonePc")}</p>}
    </div>
  );
}
