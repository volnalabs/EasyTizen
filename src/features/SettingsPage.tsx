import { ClipboardCopy, ExternalLink, FolderOpen, Lock, Save, ShieldCheck, ShieldOff, Sparkles } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useApp } from "../app/context";
import { Logo } from "../components/Logo";
import { Button, copyText, DialogCancel, Details, Field, Modal, PageHeader, Section, Segmented, Toggle, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { api, pickSavePath } from "../services/api";
import type { Settings } from "../types";
import { UpdatesSection } from "./updates/UpdatesSection";

export const REPO_URL = "https://github.com/volnalabs/TV-Deploy";

/** A labelled control in a settings list: side by side when there is room, stacked on phones. */
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="@container flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5">
      <p className="min-w-0 flex-[1_1_8rem] font-medium">{label}</p>
      <div className="min-w-0 flex-[1_1_100%] @[30rem]:flex-[0_1_19rem]">{children}</div>
    </div>
  );
}

function SecuritySection() {
  const { t } = useI18n();
  const { settings, refresh } = useApp();
  const [confirm, setConfirm] = useState(false);
  const on = settings.extra_package_checks;
  const set = async (enabled: boolean) => { await api.setExtraPackageChecks(enabled); await refresh(); };
  return (
    <Section title={t("securityTitle")} id="security">
      <Toggle checked={on} onChange={(v) => (v ? void set(true) : setConfirm(true))} label={t("extraChecksLabel")} description={t("extraChecksBody")} />
      <p className={`mt-1 flex items-start gap-2.5 rounded-control px-3 py-2.5 text-small ${on ? "bg-ok-soft" : "bg-warn-soft"}`} role="status">
        {on ? <ShieldCheck size={16} className="mt-px shrink-0 text-ok" aria-hidden /> : <ShieldOff size={16} className="mt-px shrink-0 text-warn" aria-hidden />}
        <span className="min-w-0">{on ? t("extraChecksOnState") : t("extraChecksOffState")}</span>
      </p>
      <p className="mt-3 mb-1 flex items-start gap-2.5 text-small text-muted">
        <Lock size={15} className="mt-[3px] shrink-0" aria-hidden /><span className="min-w-0">{t("extraChecksAlways")}</span>
      </p>
      {confirm && (
        <Modal title={t("extraChecksOffTitle")} onClose={() => setConfirm(false)}
          footer={<><DialogCancel>{t("extraChecksKeep")}</DialogCancel><Button variant="danger" onClick={() => { setConfirm(false); void set(false); }}>{t("extraChecksOffConfirm")}</Button></>}>
          <div className="space-y-3">
            <p>{t("extraChecksOffBody")}</p>
            <p className="flex items-start gap-2.5 text-small text-muted"><Lock size={15} className="mt-[3px] shrink-0" aria-hidden /><span className="min-w-0">{t("extraChecksAlways")}</span></p>
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
      <div className="space-y-8">
        <Section title={t("appearance")} flush>
          <SettingRow label={t("theme")}>
            <Segmented stretch label={t("theme")} value={settings.theme} onChange={(v) => void persist({ theme: v })} options={[{ value: "system", label: t("themeSystem") }, { value: "light", label: t("themeLight") }, { value: "dark", label: t("themeDark") }]} />
          </SettingRow>
          <SettingRow label={t("language")}>
            <Segmented stretch label={t("language")} value={settings.language} onChange={(v) => void persist({ language: v })} options={[{ value: "auto", label: t("langAuto") }, { value: "ru", label: "Русский" }, { value: "en", label: "English" }]} />
          </SettingRow>
        </Section>

        <SecuritySection />
        <UpdatesSection persist={persist} />

        <Section title={t("connection")} description={t("connectionBody")}>
          <div className="grid gap-4 pb-1 sm:grid-cols-2">
            <Field label={t("defaultPort")} htmlFor={portId}><input id={portId} className="input data" inputMode="numeric" enterKeyHint="done" value={port} onChange={(e) => setPort(e.target.value)} onBlur={() => void persist({})} aria-invalid={invalid} /></Field>
            <Field label={t("timeout")} htmlFor={timeoutId}><input id={timeoutId} className="input data" inputMode="numeric" enterKeyHint="done" value={timeout} onChange={(e) => setTimeoutMs(e.target.value)} onBlur={() => void persist({})} aria-invalid={invalid} /></Field>
          </div>
          {invalid && <p role="alert" className="mt-2 text-small text-err">{t("invalidSetting")}</p>}
        </Section>

        <Section title={t("diagnostics")}>
          <p className="text-muted">{t("diagnosticsBody")}</p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { if (await copyText(await loadReport())) toast("ok", t("copied")); }} icon={<ClipboardCopy size={14} aria-hidden />}>{t("diagnosticsCopy")}</Button>
            {!info.mobile && <Button size="sm" icon={<Save size={14} aria-hidden />} onClick={async () => {
              const path = await pickSavePath("easytizen-diagnostics.txt");
              if (!path) return;
              try { await api.saveTextFile(path, await loadReport()); toast("ok", t("diagnosticsSaved")); } catch { toast("err", t("err_io_error")); }
            }}>{t("diagnosticsSave")}</Button>}
            {!info.mobile && info.log_dir && <Button size="sm" variant="ghost" icon={<FolderOpen size={14} aria-hidden />} onClick={() => void api.openLogFolder().catch(() => toast("err", t("err_io_error")))}>{t("diagnosticsLogs")}</Button>}
          </div>
          <Details label={t("diagnosticsShow")} onOpen={() => void loadReport()} className="mt-2 mb-1">{report ?? "…"}</Details>
        </Section>

        <Section title={t("about")}>
          <div className="flex items-start gap-4 py-1">
            <Logo size={48} />
            <div className="min-w-0 flex-1">
              <p className="text-title font-semibold tracking-[-0.015em]">EasyTizen <span className="data ms-1 text-emph font-medium text-muted">{info.version}</span></p>
              <p className="mt-1 text-small text-muted">{t("aboutBody")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void api.openExternal(REPO_URL)} icon={<ExternalLink size={14} aria-hidden />}>{t("aboutSource")}</Button>
                <Button size="sm" variant="ghost" onClick={onShowWizard} icon={<Sparkles size={14} aria-hidden />}>{t("aboutWizard")}</Button>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
