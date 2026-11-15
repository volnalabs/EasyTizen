import { Check, CircleAlert, Download, History, Rocket, ShieldOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Button, Details, DialogCancel, Field, Modal, Notice, PasswordInput, prefersReducedMotion, Progress, Spinner, Toggle } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { opId } from "../lib/format";
import { api, on, toApiError } from "../services/api";
import type { ApiError, ExtraChecks, InstallProgress, InstallResult, InstallStage, OpenedPackage, TvInfo } from "../types";

const STAGES: InstallStage[] = ["signing", "connecting", "uploading", "installing", "verifying", "launching"];

/** Asked before every installation while the additional checks are off. */
function SkipChecksDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  const [understood, setUnderstood] = useState(false);
  return (
    <Modal title={t("skipTitle")} onClose={onCancel}
      footer={<><DialogCancel>{t("cancel")}</DialogCancel><Button variant="primary" disabled={!understood} onClick={onConfirm}>{t("skipButton")}</Button></>}>
      <div className="space-y-3">
        <p>{t("skipBody")}</p>
        <p className="text-small text-muted">{t("skipStillChecked")}</p>
        <label className="flex cursor-pointer items-start gap-3 rounded-control bg-fill p-3.5 transition-colors has-[:checked]:bg-warn-soft">
          <input type="checkbox" className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 accent-[var(--warn)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span className="font-medium">{t("skipConfirm")}</span>
        </label>
      </div>
    </Modal>
  );
}

function Success({ result, pkg, tv, onReset }: { result: InstallResult; pkg: OpenedPackage; tv: TvInfo; onReset: () => void }) {
  const { t } = useI18n();
  const { go } = useApp();
  const facts: { ok: boolean; text: string }[] = [
    { ok: result.in_app_list !== false, text: result.in_app_list === true ? t("installVerified") : result.in_app_list === false ? t("installNotInList") : t("installConfirmedByTv") },
  ];
  if (result.launched != null) facts.push({ ok: result.launched, text: result.launched ? t("installLaunched") : t("installNotLaunched") });
  const ref = useRef<HTMLDivElement>(null);
  // Bring the result into view: on a phone the button that started it may be far down.
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }); }, []);
  return (
    <div ref={ref} className="fade-up scroll-mb-6 py-2 text-center sm:py-4">
      <span className="success-pop mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok text-white dark:text-[#06150e]">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      <p className="mt-5 text-display font-semibold tracking-[-0.03em]" role="status">{t("installSuccessTitle")}</p>
      <p className="mx-auto mt-2 max-w-[40ch] text-muted">{t("installSuccess", { name: result.app_name ?? pkg.report.file_name, tv: tv.name })}</p>
      <ul className="mx-auto mt-5 w-fit max-w-full list-none space-y-1.5 p-0 text-start text-small">
        {facts.map((f) => (
          <li key={f.text} className="flex items-start gap-2">
            {f.ok ? <Check size={16} strokeWidth={2.5} className="mt-[2px] shrink-0 text-ok" aria-hidden /> : <CircleAlert size={16} className="mt-[2px] shrink-0 text-warn" aria-hidden />}
            <span className="min-w-0">{f.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-col-reverse justify-center gap-2 sm:flex-row">
        <Button variant="ghost" onClick={() => go("history")} icon={<History size={16} aria-hidden />}>{t("installOpenHistory")}</Button>
        <Button variant="primary" onClick={onReset}>{t("installAnother")}</Button>
      </div>
    </div>
  );
}

export function InstallStep({ tv, pkg, ready, waiting, willSign, profile, alreadySigned, checks, checksLoading, onResign, onReset, onInstalled }: {
  tv: TvInfo; pkg: OpenedPackage; ready: boolean; waiting: string; willSign: boolean; profile: string; alreadySigned: boolean;
  checks: ExtraChecks | null; checksLoading: boolean; onResign: (v: boolean) => void; onReset: () => void; onInstalled: () => void;
}) {
  const { t, err } = useI18n();
  const { setBusy: markBusy } = useApp();
  const [runAfter, setRunAfter] = useState(true);
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
    const off = on<InstallProgress>("install-progress", (p) => { if (p.op_id === op.current) setProgress(p); });
    return () => { void off.then((f) => f()); };
  }, []);
  useEffect(() => { markBusy("install", busy || removing); return () => markBusy("install", false); }, [busy, removing, markBusy]);

  const checksOff = !!checks && !checks.enabled;
  const canInstall = !busy && !checksLoading;

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

  if (result) return <Success result={result} pkg={pkg} tv={tv} onReset={onReset} />;

  if (busy || removing) {
    const index = progress ? STAGES.indexOf(progress.stage) : -1;
    const visible = STAGES.filter((s) => (s !== "signing" || willSign) && (s !== "launching" || runAfter));
    const measured = progress && (progress.stage === "uploading" || progress.stage === "signing" || (progress.stage === "installing" && progress.fraction > 0));
    const done = visible.filter((s) => STAGES.indexOf(s) < index).length;
    const overall = (done + (measured ? progress!.fraction : 0.15)) / visible.length;
    return (
      <div className="fade-up" aria-live="polite">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-emph font-semibold">{removing ? t("installUninstalling") : progress ? t(`stage_${progress.stage}` as Key) : t("installStarting")}</p>
          {!removing && measured && <span className="data text-small font-semibold text-accent-text">{Math.round(progress!.fraction * 100)}%</span>}
        </div>
        <Progress value={removing || index < 0 ? null : overall} label={progress ? t(`stage_${progress.stage}` as Key) : t("installStarting")} />
        {!removing && (
          <ol className="m-0 mt-5 grid list-none gap-x-4 gap-y-2.5 p-0 @container sm:grid-cols-2">
            {visible.map((s) => {
              const i = STAGES.indexOf(s);
              const state = i < index ? "done" : i === index ? "active" : "todo";
              return (
                <li key={s} className="flex items-center gap-2.5 text-small" aria-current={state === "active" ? "step" : undefined}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors duration-200 ${state === "done" ? "bg-ok text-white dark:text-[#06150e]" : state === "active" ? "bg-accent-soft text-accent-text" : "bg-fill-2"}`}>
                    {state === "done" ? <Check size={12} strokeWidth={3} aria-hidden /> : state === "active" ? <Spinner size={12} /> : null}
                  </span>
                  <span className={`min-w-0 ${state === "active" ? "font-semibold" : state === "todo" ? "text-muted" : ""}`}>
                    {t(`stage_${s}` as Key)}<span className="sr-only"> — {t(`stageState_${state}` as Key)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {!removing && (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
            <Button size="sm" onClick={() => op.current && void api.cancel(op.current)}>{t("cancel")}</Button>
            <span className="min-w-0 flex-[1_1_14rem] text-caption text-muted">{t("installCancelNote")}</span>
          </div>
        )}
      </div>
    );
  }

  // Stays mounted while the earlier steps change, so a running installation is never lost.
  if (!ready) return <p className="text-small text-muted">{waiting}</p>;

  return (
    <div className="space-y-4">
      <Toggle checked={runAfter} onChange={setRunAfter} label={t("installRunAfter")} />
      {checksOff && <Notice tone="warn" title={t("checksOffNoticeTitle")} live={false}>{t("checksOffNoticeBody")}</Notice>}
      {cancelled && <Notice tone="info" title={t("installCancelled")}>{t("installCancelledBody")}</Notice>}
      {error && (
        <Notice tone="err" title={t("installFailedTitle")}
          action={error.code === "tv_author_mismatch" && pkg.report.app_id ? <Button size="sm" onClick={() => void uninstallAndRetry()}>{t("installUninstallRetry")}</Button>
            : error.code === "tv_cert_rejected" && alreadySigned && willSign ? <Button size="sm" onClick={() => { onResign(false); void install(null, true); }}>{t("installAsIsRetry")}</Button>
              : <Button size="sm" onClick={start}>{t("retry")}</Button>}>
          <p className="text-fg">{err(error)}</p>
          {error.detail && <Details label={t("technicalDetails")}>{error.detail}</Details>}
        </Notice>
      )}
      <div>
        <Button variant="primary" size="lg" className="w-full sm:w-auto sm:min-w-[15rem]" disabled={!canInstall} onClick={start}
          icon={checksOff ? <ShieldOff size={18} aria-hidden /> : runAfter ? <Rocket size={18} aria-hidden /> : <Download size={18} aria-hidden />}>
          {t("installButton")}
        </Button>
        {willSign && <p className="mt-2.5 text-caption text-muted">{t("installOriginalSafe")}</p>}
      </div>

      {confirmSkip && <SkipChecksDialog onCancel={() => setConfirmSkip(false)} onConfirm={() => { setConfirmSkip(false); skipConfirmed.current = true; void install(); }} />}
      {askPassword && (
        <Modal title={t("passwordTitle")} onClose={() => setAskPassword(null)}
          footer={<><DialogCancel>{t("cancel")}</DialogCancel><Button variant="primary" disabled={!password} onClick={() => void install(password)}>{t("passwordUnlock")}</Button></>}>
          <form onSubmit={(e) => { e.preventDefault(); if (password) void install(password); }} className="space-y-3">
            <p className="text-muted">{t("passwordBody", { name: profile })}</p>
            <Field label={t("passwordLabel")} error={askPassword === "wrong" ? t("passwordWrong") : null}>
              <PasswordInput autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" aria-invalid={askPassword === "wrong"} enterKeyHint="done" />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}
