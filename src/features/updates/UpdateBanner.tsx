import { ArrowUpCircle, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../app/context";
import { Button, IconButton, Spinner } from "../../components/ui";
import { useI18n } from "../../hooks/i18n";
import { ApplyDialog } from "./UpdatesSection";

/** Slim bar above the content when an update is available or ready to apply. */
export function UpdateBanner({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { updater, busy } = useApp();
  const [confirm, setConfirm] = useState(false);
  const { phase, status, ready } = updater;
  const visible = !updater.dismissed && ((phase === "available" && status?.available) || phase === "downloading" || phase === "ready" || phase === "applying");
  if (!visible || !status) return null;

  const text = phase === "ready" || phase === "applying"
    ? ready?.apply === "apk" ? t("updateBannerApk", { v: ready.version }) : t("updateBannerReady", { v: ready?.version ?? status.latest })
    : phase === "downloading" ? t("updateBannerDownloading", { v: status.latest })
      : t("updateAvailable", { v: status.latest });

  return (
    <div className="safe-x mx-auto w-full max-w-[74rem] shrink-0 px-3 pt-2 sm:px-8 sm:pt-4 lg:px-10">
      <div role="status" className="fade-up flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] bg-accent-soft py-2 ps-4 pe-2">
        <span className="flex min-w-0 flex-[1_1_14rem] items-center gap-2.5 font-medium">
          {phase === "downloading" ? <Spinner size={18} className="text-accent-text" /> : <ArrowUpCircle size={18} className="shrink-0 text-accent-text" aria-hidden />}
          <span className="min-w-0">{text}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {phase === "ready" || phase === "applying" ? (
            <Button size="sm" variant="primary" busy={phase === "applying"} disabled={busy} title={busy ? t("updateBusy") : undefined}
              onClick={() => (ready?.apply === "apk" ? void updater.apply() : setConfirm(true))} icon={<RotateCw size={14} aria-hidden />}>
              {ready?.apply === "apk" ? t("updateInstallApk") : ready?.apply === "installer" ? t("updateInstallRestart") : t("updateRestart")}
            </Button>
          ) : <Button size="sm" variant="ghost" className="text-accent-text" onClick={onOpen}>{t("updateDetails")}</Button>}
          <IconButton label={t("close")} onClick={updater.dismiss}><X size={16} aria-hidden /></IconButton>
        </span>
        {confirm && ready && <ApplyDialog ready={ready} onClose={() => setConfirm(false)} />}
      </div>
    </div>
  );
}
