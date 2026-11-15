import { Check, Download, History, KeyRound, Rocket, ShieldOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Button, Details, Field, IconTile, Modal, Notice, Progress, Spinner, Toggle } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { daysLeft, opId } from "../lib/format";
import { prefersOriginalSignature } from "../lib/tv";
import { api, on, toApiError } from "../services/api";
import type { ApiError, ExtraChecks, InstallProgress, InstallResult, InstallStage, OpenedPackage, TvInfo } from "../types";
import { CreateCertificateDialog, ImportCertificateDialog } from "./CertDialogs";

const STAGES: InstallStage[] = ["signing", "connecting", "uploading", "installing", "verifying", "launching"];

/** Asked before every installation while the additional checks are off. */
function SkipChecksDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  const [understood, setUnderstood] = useState(false);
  return (
    <Modal title={t("skipTitle")} onClose={onCancel}
      footer={<><Button variant="ghost" onClick={onCancel}>{t("cancel")}</Button><Button variant="primary" disabled={!understood} onClick={onConfirm}>{t("skipButton")}</Button></>}>
      <div className="space-y-3">
        <p>{t("skipBody")}</p>
        <p className="text-small text-muted">{t("skipStillChecked")}</p>
        <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line-strong p-3 has-[:checked]:border-warn has-[:checked]:bg-warn-soft">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--warn)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span className="font-medium">{t("skipConfirm")}</span>
        </label>
      </div>
    </Modal>
  );
}

export function InstallStep({ tv, pkg, resign, onResign, checks, checksLoading, onReset, onInstalled }: {
  tv: TvInfo; pkg: OpenedPackage; resign: boolean; onResign: (v: boolean) => void;
  checks: ExtraChecks | null; checksLoading: boolean; onReset: () => void; onInstalled: () => void;
}) {
  const { t, err } = useI18n();
  const { settings, setBusy: markBusy, go } = useApp();
  const profiles = useMemo(
    () => settings.certificate_profiles.filter((p) => p.engine === "builtin" && !!tv.duid && p.duids.some((d) => d.toLowerCase() === tv.duid!.toLowerCase()) && (daysLeft(p.expires_at) ?? 1) >= 0),
    [settings.certificate_profiles, tv.duid],
  );
  const legacy = useMemo(
    () => settings.certificate_profiles.some((p) => p.engine === "sdk" && !!tv.duid && p.duids.some((d) => d.toLowerCase() === tv.duid!.toLowerCase())),
    [settings.certificate_profiles, tv.duid],
  );
  const alreadySigned = pkg.report.signature === "signed_structure";
  const [profile, setProfile] = useState("");
  const [runAfter, setRunAfter] = useState(true);
  const [dialog, setDialog] = useState<"create" | "import" | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [askPassword, setAskPassword] = useState<"required" | "wrong" | null>(null);
  const [password, setPassword] = useState("");
  const [removing, setRemoving] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const skipConfirmed = useRef(false);
  const op = useRef<string | null>(null);

  useEffect(() => {
    if (!profiles.some((p) => p.name === profile)) setProfile(profiles[0]?.name ?? "");
  }, [profiles, profile]);
  useEffect(() => {
    const off = on<InstallProgress>("install-progress", (p) => { if (p.op_id === op.current) setProgress(p); });
    return () => { void off.then((f) => f()); };
  }, []);
  useEffect(() => { markBusy("install", busy || removing); return () => markBusy("install", false); }, [busy, removing, markBusy]);

  const willSign = resign || !alreadySigned;
  const checksOff = !!checks && !checks.enabled;
  const blocked = !!checks?.enabled && checks.findings.some((f) => f.blocking);
  const canInstall = !busy && !checksLoading && !blocked && (willSign ? !!profile && !!tv.duid : true);

  const install = async (withPassword: string | null = null, asIs = false) => {
    const sign = willSign && !asIs;
    const id = opId();
    op.current = id;
    setBusy(true); setError(null); setResult(null); setCancelled(false); setProgress(null); setAskPassword(null);
    try {
      setResult(await api.installPackage({
        packagePath: pkg.path, profileName: sign ? profile : null, ip: tv.ip, port: tv.port, duid: tv.duid,
        runAfterInstall: runAfter, resign: sign, password: withPassword, checksSkipConfirmed: checksOff && skipConfirmed.current,
      }, id));
      onInstalled();
    } catch (e) {
      const parsed = toApiError(e);
      if (parsed.code === "cancelled") setCancelled(true);
      else if (parsed.code === "cert_password_required") setAskPassword("required");
      else if (parsed.code === "cert_password_wrong") setAskPassword("wrong");
      else setError(parsed);
    } finally {
      setBusy(false); op.current = null; setPassword("");
    }
  };
  const start = () => {
    if (checksOff) { setConfirmSkip(true); return; }
    void install();
  };

  const uninstallAndRetry = async () => {
    if (!pkg.report.app_id) return;
    setRemoving(true);
    try { await api.uninstallApp(tv.ip, tv.port, pkg.report.app_id); setRemoving(false); await install(); }
    catch (e) { setRemoving(false); setError(toApiError(e)); }
  };

  if (result) {
    return (
      <div className="fade-up py-3 text-center sm:py-5">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok-soft text-ok">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <p className="mt-4 text-display font-semibold tracking-[-0.02em]" role="status">{t("installSuccessTitle")}</p>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-muted">{t("installSuccess", { name: result.app_name ?? pkg.report.file_name, tv: tv.name })}</p>
        <p className="mx-auto mt-1 max-w-[42ch] text-small text-muted">{result.in_app_list === true ? t("installVerified") : t("installConfirmedByTv")}</p>
        {result.in_app_list === false && <p className="mx-auto mt-1 max-w-[42ch] text-small text-warn">{t("installNotInList")}</p>}
        {result.launched != null && <p className={`mx-auto mt-1 max-w-[42ch] text-small ${result.launched ? "text-muted" : "text-warn"}`}>{result.launched ? t("installLaunched") : t("installNotLaunched")}</p>}
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button variant="ghost" onClick={() => go("history")}><History size={16} aria-hidden />{t("installOpenHistory")}</Button>
          <Button variant="primary" onClick={onReset}>{t("installAnother")}</Button>
        </div>
      </div>
    );
  }

  if (busy || removing) {
    const index = progress ? STAGES.indexOf(progress.stage) : -1;
    const visible = STAGES.filter((s) => (s !== "signing" || willSign) && (s !== "launching" || runAfter));
    const measured = progress && (progress.stage === "uploading" || progress.stage === "signing" || (progress.stage === "installing" && progress.fraction > 0));
    return (
      <div className="fade-up" aria-live="polite">
        <ol className="relative m-0 list-none space-y-0 p-0">
          {removing && <li className="flex items-center gap-3 py-2"><Spinner size={18} className="text-accent-text" />{t("installUninstalling")}</li>}
          {!removing && visible.map((s, n) => {
            const i = STAGES.indexOf(s);
            const state = i < index ? "done" : i === index ? "active" : "todo";
            return (
              <li key={s} className="relative flex items-center gap-3 py-2" aria-current={state === "active" ? "step" : undefined}>
                {n < visible.length - 1 && <span className={`absolute top-[2.125rem] left-[0.6875rem] h-[calc(100%-1.75rem)] w-px ${state === "done" ? "bg-ok" : "bg-line-strong"}`} aria-hidden />}
                <span className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full ${state === "done" ? "bg-ok-soft text-ok" : state === "active" ? "bg-accent-soft text-accent-text" : "border border-line-strong bg-surface"}`}>
                  {state === "done" ? <Check size={14} strokeWidth={2.75} aria-hidden /> : state === "active" ? <Spinner size={14} /> : null}
                </span>
                <span className={`min-w-0 flex-1 ${state === "active" ? "font-semibold" : state === "todo" ? "text-muted" : ""}`}>
                  {t(`stage_${s}` as Key)}<span className="sr-only"> — {t(`stageState_${state}` as Key)}</span>
                </span>
                {state === "active" && measured && <span className="data text-small text-muted">{Math.round(progress!.fraction * 100)}%</span>}
              </li>
            );
          })}
        </ol>
        <div className="mt-3"><Progress value={measured ? progress!.fraction : null} label={progress ? t(`stage_${progress.stage}` as Key) : t("stage_signing")} /></div>
        {!removing && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button size="sm" onClick={() => op.current && void api.cancel(op.current)}>{t("cancel")}</Button>
            <span className="min-w-0 flex-[1_1_14rem] text-small text-muted">{t("installCancelNote")}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!tv.duid && willSign && <Notice tone="warn">{t("tvNoDuid")}</Notice>}
      {alreadySigned && <Toggle checked={resign} onChange={onResign} label={t("installResign")}
        description={prefersOriginalSignature(tv.tizen_version, alreadySigned) ? t("installResignHintOldTv", { tizen: tv.tizen_version ?? "" }) : t("installResignHint")} />}

      {willSign && tv.duid && (profiles.length > 0 ? (
        <Field label={t("installCert")} htmlFor="install-cert">
          <div className="flex gap-2">
            <select id="install-cert" value={profile} onChange={(e) => setProfile(e.target.value)} className="input min-w-0 flex-1">
              {profiles.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.identity}</option>)}
            </select>
            <Button onClick={() => setDialog("create")} aria-label={t("installCertCreate")} title={t("installCertCreate")}><KeyRound size={16} aria-hidden /></Button>
          </div>
        </Field>
      ) : (
        <div className="rounded-[12px] border border-line bg-surface-2/50 p-4">
          <div className="flex items-start gap-3">
            <IconTile><KeyRound size={20} aria-hidden /></IconTile>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t("installCertNone")}</p>
              <p className="mt-0.5 text-small text-muted">{legacy ? t("installCertLegacy") : t("installCertNoneBody")}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:pl-[3.25rem]">
            <Button variant="primary" onClick={() => setDialog("create")}><KeyRound size={16} aria-hidden />{t("installCertCreate")}</Button>
            <Button onClick={() => setDialog("import")}>{t("installCertImport")}</Button>
            {legacy && <Button variant="ghost" onClick={() => go("certs")}>{t("certTransferOpen")}</Button>}
          </div>
        </div>
      ))}

      <Toggle checked={runAfter} onChange={setRunAfter} label={t("installRunAfter")} />
      {checksOff && (
        <Notice tone="warn" title={t("checksOffNoticeTitle")} live={false}>{t("checksOffNoticeBody")}</Notice>
      )}
      {blocked && (
        <Notice tone="err" title={t("checksBlockedTitle")} action={<Button size="sm" onClick={() => go("settings")}>{t("checksOpenSettings")}</Button>}>
          {t("checksBlockedBody")}
        </Notice>
      )}
      {cancelled && <Notice tone="info">{t("installCancelled")}</Notice>}
      {error && (
        <Notice tone="err" title={t("installFailedTitle")}
          action={error.code === "tv_author_mismatch" && pkg.report.app_id ? <Button size="sm" onClick={() => void uninstallAndRetry()}>{t("installUninstallRetry")}</Button>
            : error.code === "tv_cert_rejected" && alreadySigned && willSign ? <Button size="sm" onClick={() => { onResign(false); void install(null, true); }}>{t("installAsIsRetry")}</Button>
              : undefined}>
          <p className="text-fg">{err(error)}</p>
          {error.detail && <Details label={t("technicalDetails")}>{error.detail}</Details>}
        </Notice>
      )}
      <div className="border-t border-line pt-4">
        <Button variant="primary" size="lg" className="w-full sm:w-auto" disabled={!canInstall} onClick={start}>
          {checksOff ? <ShieldOff size={18} aria-hidden /> : runAfter ? <Rocket size={18} aria-hidden /> : <Download size={18} aria-hidden />}{t("installButton")}
        </Button>
        {willSign && <p className="mt-2.5 text-small text-muted">{t("installOriginalSafe")}</p>}
      </div>

      {dialog === "create" && <CreateCertificateDialog preselectDuid={tv.duid} onClose={() => setDialog(null)} onCreated={(p) => { setDialog(null); setProfile(p.name); }} />}
      {dialog === "import" && <ImportCertificateDialog onClose={() => setDialog(null)} onImported={(p) => { setDialog(null); setProfile(p.name); }} />}
      {confirmSkip && <SkipChecksDialog onCancel={() => setConfirmSkip(false)} onConfirm={() => { setConfirmSkip(false); skipConfirmed.current = true; void install(); }} />}
      {askPassword && (
        <Modal title={t("passwordTitle")} onClose={() => setAskPassword(null)}
          footer={<><Button variant="ghost" onClick={() => setAskPassword(null)}>{t("cancel")}</Button><Button variant="primary" disabled={!password} onClick={() => void install(password)}>{t("passwordUnlock")}</Button></>}>
          <form onSubmit={(e) => { e.preventDefault(); if (password) void install(password); }} className="space-y-3">
            <p className="text-muted">{t("passwordBody", { name: profile })}</p>
            <Field label={t("passwordLabel")} error={askPassword === "wrong" ? t("passwordWrong") : null}>
              <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" aria-invalid={askPassword === "wrong"} />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}
