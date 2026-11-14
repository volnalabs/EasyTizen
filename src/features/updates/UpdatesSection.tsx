import { AlertTriangle, ArrowUpCircle, CheckCircle2, Download, ExternalLink, RefreshCw, RotateCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../app/context";
import { Button, DataList, Details, Modal, Notice, Progress, Row, Section, Spinner, Toggle } from "../../components/ui";
import { useI18n } from "../../hooks/i18n";
import type { Key } from "../../i18n";
import { formatBytes, formatDate } from "../../lib/format";
import { api } from "../../services/api";
import type { Settings, UpdateReady } from "../../types";

export function ApplyDialog({ ready, onClose }: { ready: UpdateReady; onClose: () => void }) {
  const { t } = useI18n();
  const { updater, busy } = useApp();
  const body = ready.apply === "installer" ? t("updateApplyInstaller", { v: ready.version }) : t("updateApplyRestart", { v: ready.version });
  return (
    <Modal title={t("updateApplyTitle")} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t("updateLater")}</Button>
        <Button variant="primary" disabled={busy} busy={updater.phase === "applying"} onClick={() => void updater.apply()}><RotateCw size={16} aria-hidden />{ready.apply === "installer" ? t("updateInstallRestart") : t("updateRestart")}</Button></>}>
      <div className="space-y-3">
        <p>{body}</p>
        <p className="text-small text-muted">{t("updateKeepsData")}</p>
        {busy && <Notice tone="warn">{t("updateBusy")}</Notice>}
        {updater.error && <Notice tone="err">{t(`err_${updater.error}` as Key)}</Notice>}
      </div>
    </Modal>
  );
}

/** Settings → App updates: automatic mode switch, status, manual check and the update itself. */
export function UpdatesSection({ persist }: { persist: (patch: Partial<Settings>) => Promise<void> }) {
  const { t, lang, err } = useI18n();
  const { settings, info, updater, busy } = useApp();
  const [confirm, setConfirm] = useState(false);
  const { phase, status, ready } = updater;
  const autoBody = status?.install === "manual" && status.manual_reason ? t(`updateManual_${status.manual_reason}` as Key, { arch: info.arch })
    : info.mobile ? t("updatesAutoBodyAndroid") : t("updatesAutoBody");
  const last = settings.last_update_check;

  const state = (phase === "ready" || phase === "applying") && ready ? { icon: <ShieldCheck size={16} className="shrink-0 text-ok" aria-hidden />, text: ready.apply === "apk" ? t("updateBannerApk", { v: ready.version }) : t("updateBannerReady", { v: ready.version }), tone: "text-fg font-semibold" }
    : phase === "downloading" && status ? { icon: <Spinner size={16} className="text-accent-text" />, text: t("updateBannerDownloading", { v: status.latest }), tone: "text-fg" }
    : phase === "checking" ? { icon: <Spinner size={16} className="text-muted" />, text: t("updatesChecking"), tone: "text-muted" }
    : phase === "latest" ? { icon: <CheckCircle2 size={16} className="shrink-0 text-ok" aria-hidden />, text: t("updatesLatest"), tone: "text-fg" }
      : phase === "error" && !status?.available ? { icon: <AlertTriangle size={16} className="shrink-0 text-warn" aria-hidden />, text: err(updater.error ?? "update_network"), tone: "text-fg" }
        : status?.available ? { icon: <ArrowUpCircle size={16} className="shrink-0 text-accent-text" aria-hidden />, text: t("updateAvailable", { v: status.latest }), tone: "text-fg font-semibold" }
          : { icon: null, text: t("updatesNotChecked"), tone: "text-muted" };

  return (
    <Section title={t("updatesTitle")} id="updates">
      <Toggle checked={settings.check_updates} onChange={(v) => void persist({ check_updates: v })} label={t("updatesAuto")} description={autoBody} />
      <DataList className="mt-2 border-t border-line">
        <Row label={t("updatesCurrent")} data>{info.version}</Row>
        <Row label={t("updatesLastCheck")}>{last ? formatDate(last, lang, true) : t("updatesNever")}</Row>
      </DataList>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <p role="status" aria-live="polite" className={`flex min-w-0 flex-[1_1_14rem] items-start gap-2 ${state.tone}`}>{state.icon && <span className="mt-0.5">{state.icon}</span>}<span className="min-w-0">{state.text}</span></p>
        <Button size="sm" busy={phase === "checking"} disabled={phase === "downloading" || phase === "applying"} onClick={() => void updater.check(true)}>
          {phase !== "checking" && <RefreshCw size={14} aria-hidden />}{t("updatesCheck")}
        </Button>
      </div>

      {status?.available && (
        <div className="fade-up mt-4 rounded-[12px] border border-accent-line bg-accent-soft/50 p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-emph font-semibold">EasyTizen {status.latest}</p>
            <p className="text-small text-muted">
              {[status.published_at && formatDate(Date.parse(status.published_at) / 1000, lang), status.size != null && formatBytes(status.size, lang)].filter(Boolean).join(" · ")}
            </p>
          </div>
          {status.notes && <Details prose label={t("updateNotes")}>{status.notes}</Details>}

          {phase === "downloading" && (
            <div className="mt-3">
              <div className="mb-1.5 flex justify-between gap-3 text-small"><span>{t("updateDownloading")}</span>{updater.progress != null && <span className="data text-muted">{Math.round(updater.progress * 100)}%</span>}</div>
              <Progress value={updater.progress} label={t("updateDownloading")} />
            </div>
          )}
          {(phase === "ready" || phase === "applying") && ready && (
            <div className="mt-3 space-y-3">
              <p className="flex items-start gap-2 text-small"><ShieldCheck size={16} className="mt-px shrink-0 text-ok" aria-hidden />{ready.apply === "apk" ? t("updateApkVerified", { v: ready.version }) : ready.apply === "installer" ? t("updateInstallerVerified", { v: ready.version }) : t("updateInstalledRestart", { v: ready.version })}</p>
              {busy && <Notice tone="warn">{t("updateBusy")}</Notice>}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" busy={phase === "applying"} disabled={busy} onClick={() => (ready.apply === "apk" ? void updater.apply() : setConfirm(true))}>
                  <RotateCw size={16} aria-hidden />{ready.apply === "apk" ? t("updateInstallApk") : ready.apply === "installer" ? t("updateInstallRestart") : t("updateRestart")}
                </Button>
                {updater.error === "update_permission" && <Button onClick={() => void api.updateOpenPermissionSettings()}>{t("updateOpenPermission")}</Button>}
              </div>
              {updater.error && <Notice tone="err">{err(updater.error)}</Notice>}
            </div>
          )}
          {(phase === "available" || (phase === "error" && status.available)) && (
            <div className="mt-3 space-y-3">
              {status.install === "manual" && status.manual_reason && <p className="text-small text-muted">{t(`updateManual_${status.manual_reason}` as Key, { arch: info.arch })}</p>}
              {phase === "error" && updater.error && <Notice tone="err">{err(updater.error)}</Notice>}
              <div className="flex flex-wrap gap-2">
                {status.install === "manual"
                  ? <Button variant="primary" onClick={() => void api.openExternal(status.download_url)}><Download size={16} aria-hidden />{t("updateDownload")}</Button>
                  : <Button variant="primary" onClick={() => void updater.download()}><Download size={16} aria-hidden />{t("updateInstall")}</Button>}
                <Button onClick={() => void api.openExternal(status.release_url)}><ExternalLink size={16} aria-hidden />{t("updateReleasePage")}</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="mt-4 text-caption text-muted">{info.mobile ? t("updatesHowAndroid") : t("updatesHowDesktop")}</p>
      {confirm && ready && <ApplyDialog ready={ready} onClose={() => setConfirm(false)} />}
    </Section>
  );
}
