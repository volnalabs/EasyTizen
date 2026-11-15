import { ClipboardCopy, ExternalLink, FolderOpen, Lock, Save, ShieldCheck, ShieldOff } from "lucide-react";
import { useId, useState } from "react";
import { useApp } from "../app/context";
import { Logo } from "../components/Logo";
import { Button, copyText, Details, Field, Modal, Notice, PageHeader, Section, Segmented, Toggle, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { api, pickSavePath } from "../services/api";
import type { Settings } from "../types";
import { UpdatesSection } from "./updates/UpdatesSection";

export const REPO_URL = "https://github.com/volnalabs/TV-Deploy";

function SecuritySection() {
  const { t } = useI18n();
  const { settings, refresh } = useApp();
  const [confirm, setConfirm] = useState(false);
  const on = settings.extra_package_checks;
  const set = async (enabled: boolean) => { await api.setExtraPackageChecks(enabled); await refresh(); };
  return (
    <Section title={t("securityTitle")} id="security">
      <Toggle checked={on} onChange={(v) => (v ? void set(true) : setConfirm(true))} label={t("extraChecksLabel")} description={t("extraChecksBody")} />
      <div className={`mt-2 flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-small ${on ? "bg-ok-soft" : "bg-warn-soft"}`} role="status">
        {on ? <ShieldCheck size={16} className="mt-px shrink-0 text-ok" aria-hidden /> : <ShieldOff size={16} className="mt-px shrink-0 text-warn" aria-hidden />}
        <span className="min-w-0">{on ? t("extraChecksOnState") : t("extraChecksOffState")}</span>
      </div>
      <div className="mt-3 flex items-start gap-2.5 text-small text-muted">
        <Lock size={16} className="mt-px shrink-0" aria-hidden />
        <p className="min-w-0">{t("extraChecksAlways")}</p>
      </div>
      {confirm && (
        <Modal title={t("extraChecksOffTitle")} onClose={() => setConfirm(false)}
          footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>{t("extraChecksKeep")}</Button><Button variant="danger" onClick={() => { setConfirm(false); void set(false); }}>{t("extraChecksOffConfirm")}</Button></>}>
          <div className="space-y-3">
            <p>{t("extraChecksOffBody")}</p>
            <Notice tone="info" live={false}>{t("extraChecksAlways")}</Notice>
          </div>
        </Modal>
      )}
    </Section>
  );
}

export function SettingsPage({ onShowWizard }: { onShowWizard: () => void }) {
  const { t } = useI18n();
  const { settings, refresh, info } = useApp();
  const toast = useToast();
  const [port, setPort] = useState(String(settings.default_port));
  const [timeout, setTimeoutMs] = useState(String(settings.timeout_ms));
  const [invalid, setInvalid] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const portId = useId();
  const timeoutId = useId();

  const persist = async (patch: Partial<Settings>, p = port, tm = timeout) => {
    const next = { ...settings, ...patch };
    try {
      await api.savePreferences({ theme: next.theme, language: next.language, default_port: Number(p), timeout_ms: Number(tm), check_updates: next.check_updates });
      setInvalid(false);
      await refresh();
    } catch { setInvalid(true); }
  };
  const loadReport = async () => { const text = report ?? (await api.diagnosticsReport()); setReport(text); return text; };

  return (
    <div>
      <PageHeader title={t("settingsTitle")} />
      <div className="space-y-7">
        <Section title={t("appearance")}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-small font-semibold">{t("theme")}</p>
              <Segmented stretch label={t("theme")} value={settings.theme} onChange={(v) => void persist({ theme: v })} options={[{ value: "system", label: t("themeSystem") }, { value: "light", label: t("themeLight") }, { value: "dark", label: t("themeDark") }]} />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-small font-semibold">{t("language")}</p>
              <Segmented stretch label={t("language")} value={settings.language} onChange={(v) => void persist({ language: v })} options={[{ value: "auto", label: t("langAuto") }, { value: "ru", label: "Русский" }, { value: "en", label: "English" }]} />
            </div>
          </div>
        </Section>

        <SecuritySection />
        <UpdatesSection persist={persist} />


        <Section title={t("connection")}>
          <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
            <Field label={t("defaultPort")} htmlFor={portId}><input id={portId} className="input data" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} onBlur={() => void persist({})} aria-invalid={invalid} /></Field>
            <Field label={t("timeout")} htmlFor={timeoutId}><input id={timeoutId} className="input data" inputMode="numeric" value={timeout} onChange={(e) => setTimeoutMs(e.target.value)} onBlur={() => void persist({})} aria-invalid={invalid} /></Field>
          </div>
          {invalid && <p role="alert" className="mt-2 text-small text-err">{t("invalidSetting")}</p>}
        </Section>

        <Section title={t("diagnostics")}>
          <p className="text-muted">{t("diagnosticsBody")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { if (await copyText(await loadReport())) toast("ok", t("copied")); }}><ClipboardCopy size={14} aria-hidden />{t("diagnosticsCopy")}</Button>
            {!info.mobile && <Button size="sm" onClick={async () => {
              const path = await pickSavePath("easytizen-diagnostics.txt");
              if (!path) return;
              try { await api.saveTextFile(path, await loadReport()); toast("ok", t("diagnosticsSaved")); } catch { toast("err", t("err_io_error")); }
            }}><Save size={14} aria-hidden />{t("diagnosticsSave")}</Button>}
            {!info.mobile && info.log_dir && <Button size="sm" variant="ghost" onClick={() => void api.openLogFolder().catch(() => toast("err", t("err_io_error")))}><FolderOpen size={14} aria-hidden />{t("diagnosticsLogs")}</Button>}
          </div>
          <Details label={t("diagnosticsShow")} onOpen={() => void loadReport()}>{report ?? "…"}</Details>
        </Section>

        <Section title={t("about")}>
          <div className="flex items-start gap-3.5">
            <Logo size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-emph font-semibold">EasyTizen <span className="data font-normal text-muted">{info.version}</span></p>
              <p className="mt-1 text-small text-muted">{t("aboutBody")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void api.openExternal(REPO_URL)}><ExternalLink size={14} aria-hidden />{t("aboutSource")}</Button>
                <Button size="sm" variant="ghost" onClick={onShowWizard}>{t("aboutWizard")}</Button>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
