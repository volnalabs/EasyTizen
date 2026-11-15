import { CheckCircle2, CircleAlert, FileArchive, Lock, ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestion, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../app/context";
import { Button, DataList, Details, Pill, Row, Spinner } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { hasKey } from "../i18n";
import { formatBytes } from "../lib/format";
import { api, inTauri, pickFile, toApiError } from "../services/api";
import type { ApiError, CheckCode, ExtraChecks, OpenedPackage, SignatureState } from "../types";

const SIG_TONE: Record<SignatureState, "ok" | "warn" | "err" | "neutral"> = { signed_structure: "ok", unsigned: "neutral", partial: "warn", malformed: "err" };
const CHECK_ORDER: CheckCode[] = ["app_id", "entry_point", "native_code", "duplicates", "signature"];

/** Both check layers: mandatory file safety (always) and the additional checks (setting). */
export function ChecksPanel({ checks, loading, error }: { checks: ExtraChecks | null; loading: boolean; error: string | null }) {
  const { t, err } = useI18n();
  const { go } = useApp();
  const failed = checks?.findings.filter((f) => f.blocking) ?? [];
  return (
    <ul className="m-0 list-none space-y-3 p-0" aria-label={t("checksTitle")}>
      <li className="flex gap-3">
        <Lock size={17} className="mt-0.5 shrink-0 text-ok" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t("checksMandatory")} <span className="text-ok">· {t("checksPassed")}</span></p>
          <p className="mt-0.5 text-small text-muted">{t("checksMandatoryBody")}</p>
        </div>
      </li>
      <li className="flex gap-3">
        {loading ? <Spinner size={17} className="mt-0.5 text-muted" />
          : !checks?.enabled ? <ShieldOff size={17} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            : failed.length ? <ShieldAlert size={17} className="mt-0.5 shrink-0 text-err" aria-hidden />
              : <ShieldCheck size={17} className="mt-0.5 shrink-0 text-ok" aria-hidden />}
        <div className="min-w-0 flex-1">
          {loading ? <p className="font-medium">{t("checksExtra")} <span className="text-muted">· {t("checksRunning")}</span></p>
            : error ? <p className="font-medium">{t("checksExtra")} <span className="text-err">· {err(error)}</span></p>
              : !checks?.enabled ? (
                <>
                  <p className="font-medium">{t("checksExtra")} <span className="text-warn">· {t("checksOff")}</span></p>
                  <p className="mt-0.5 text-small text-muted">{t("checksOffBody")}</p>
                  <Button variant="link" size="sm" className="-ms-1 mt-1" onClick={() => go("settings")}>{t("checksOpenSettings")}</Button>
                </>
              ) : (
                <>
                  <p className="font-medium">{t("checksExtra")} <span className={failed.length ? "text-err" : "text-ok"}>· {failed.length ? t("checksFailed", { n: failed.length }) : t("checksExtraPassed")}</span></p>
                  <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                    {CHECK_ORDER.filter((c) => checks.ran.includes(c)).map((c) => {
                      const findings = checks.findings.filter((f) => f.check === c);
                      const blocking = findings.some((f) => f.blocking);
                      const Icon = blocking ? XCircle : findings.length ? CircleAlert : CheckCircle2;
                      return (
                        <li key={c} className="flex gap-2 text-small">
                          <Icon size={15} className={`mt-[3px] shrink-0 ${blocking ? "text-err" : findings.length ? "text-warn" : "text-ok"}`} aria-hidden />
                          <div className="min-w-0">
                            <p className={findings.length ? "font-medium" : "text-muted"}>{t(`check_${c}` as Key)}
                              <span className="sr-only"> — {blocking ? t("checksStateFailed") : findings.length ? t("checksStateWarning") : t("checksStatePassed")}</span></p>
                            {findings.map((f) => (
                              <p key={f.code} className="mt-0.5 text-muted">
                                {hasKey(`finding_${f.code}`) ? t(`finding_${f.code}` as Key, { detail: f.detail ?? "" }) : f.code}
                              </p>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2.5 text-caption text-muted">{t("checksNotAntivirus")}</p>
                </>
              )}
        </div>
      </li>
    </ul>
  );
}

/** One line that says how the checks went; details on demand, expanded when something is wrong. */
function ChecksSummary({ checks, loading, error }: { checks: ExtraChecks | null; loading: boolean; error: string | null }) {
  const { t } = useI18n();
  const { go } = useApp();
  const failed = checks?.findings.filter((f) => f.blocking).length ?? 0;
  const warnings = checks?.findings.filter((f) => !f.blocking).length ?? 0;
  const state = loading ? { icon: <Spinner size={16} className="text-muted" />, text: t("checksRunningShort"), tone: "text-muted" }
    : error ? { icon: <ShieldAlert size={16} className="shrink-0 text-err" aria-hidden />, text: t("checksErrorShort"), tone: "text-err" }
      : !checks?.enabled ? { icon: <ShieldOff size={16} className="shrink-0 text-warn" aria-hidden />, text: t("checksOffShort"), tone: "text-warn" }
        : failed ? { icon: <ShieldAlert size={16} className="shrink-0 text-err" aria-hidden />, text: t("checksFailedShort", { n: failed }), tone: "text-err" }
          : { icon: <ShieldCheck size={16} className="shrink-0 text-ok" aria-hidden />, text: warnings ? t("checksPassedWarnings", { n: warnings }) : t("checksPassedShort"), tone: "text-ok" };
  const open = !!error || failed > 0;
  return (
    <div className="mt-4 border-t border-line pt-3.5" role="group" aria-label={t("checksTitle")}>
      <p className={`flex items-center gap-2 font-medium ${state.tone}`} role="status" aria-live="polite">{state.icon}<span className="min-w-0">{state.text}</span></p>
      {open ? (
        <div className="mt-3">
          <ChecksPanel checks={checks} loading={loading} error={error} />
          {failed > 0 && (
            <div className="mt-4 rounded-control bg-err-soft px-3.5 py-3 text-small">
              <p>{t("checksBlockedHint")}</p>
              <Button variant="link" size="sm" className="-ms-1 mt-1" onClick={() => go("settings")}>{t("checksOpenSettings")}</Button>
            </div>
          )}
        </div>
      )
        : !loading && <Details label={t("checksWhat")} inline className="mt-1.5"><ChecksPanel checks={checks} loading={loading} error={error} /></Details>}
    </div>
  );
}

export function PackageStep({ pkg, onPackage, checks, checksLoading, checksError, locked }: {
  pkg: OpenedPackage | null; onPackage: (p: OpenedPackage | null) => void;
  checks: ExtraChecks | null; checksLoading: boolean; checksError: string | null; locked: boolean;
}) {
  const { t, lang, err } = useI18n();
  const { info } = useApp();
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const open = useCallback(async (source: string) => {
    setBusy(true); setError(null);
    try { onPackage(await api.openPackage(source)); }
    catch (e) { onPackage(null); setError(toApiError(e)); }
    finally { setBusy(false); }
  }, [onPackage]);

  // Native drag & drop (desktop): the webview hands over real file paths.
  useEffect(() => {
    if (!inTauri || info.mobile || locked) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "enter" || p.type === "over") setHover(true);
        else if (p.type === "leave") setHover(false);
        else if (p.type === "drop") { setHover(false); if (p.paths[0]) void open(p.paths[0]); }
      })).then((u) => (cancelled ? u() : (off = u))).catch(() => undefined);
    return () => { cancelled = true; off?.(); };
  }, [open, info.mobile, locked]);

  // Android pickers cannot filter by the .wgt extension; the backend checks the content.
  const pick = async () => { const p = await pickFile(info.mobile ? undefined : ["wgt"], t("dropTitle")); if (p) await open(p); };

  if (pkg) {
    const r = pkg.report;
    const SigIcon = r.signature === "signed_structure" ? ShieldCheck : r.signature === "malformed" ? ShieldAlert : ShieldQuestion;
    const meta = [r.version && `v${r.version}`, formatBytes(r.size_bytes, lang)].filter(Boolean).join(" · ");
    return (
      <div className="@container fade-up">
        <div className="flex items-center gap-3">
          <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-text @[19rem]:grid"><FileArchive size={20} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="text-emph font-semibold break-words">{r.app_name ?? r.file_name}</p>
            <p className="text-small text-muted"><span className="data whitespace-nowrap">{meta}</span> · <Pill tone={SIG_TONE[r.signature]} className="align-[1px]"><SigIcon size={12} aria-hidden />{t(`sig_${r.signature}` as Key)}</Pill></p>
          </div>
          <Button size="sm" disabled={locked} onClick={() => onPackage(null)}>{t("pkgClear")}</Button>
        </div>
        <Details label={t("pkgDetails")} inline className="mt-2">
          <div>
            <DataList>
              <Row label={t("pkgFile")} data>{r.file_name}</Row>
              {r.version && <Row label={t("pkgVersion")} data>{r.version}</Row>}
              {r.app_id && <Row label={t("pkgId")} data>{r.app_id}</Row>}
              <Row label={t("pkgSize")}>{formatBytes(r.size_bytes, lang)} · {t("pkgFilesCount", { n: r.entry_count })}</Row>
              {r.required_api_version && <Row label={t("pkgApi")} data>{r.required_api_version}</Row>}
              <Row label={t("pkgSignature")}>{t(`sig_${r.signature}` as Key)}</Row>
            </DataList>
            <p className="mt-2 text-muted">{t(`sigNote_${r.signature}` as Key)}</p>
          </div>
        </Details>
        {checks && !checks.enabled && r.warnings.map((w) => { const k = `warn_${w.code}`; return hasKey(k) ? <p key={w.code} className="mt-2 flex gap-2 text-small text-warn"><CircleAlert size={15} className="mt-[3px] shrink-0" aria-hidden />{t(k)}</p> : null; })}
        <ChecksSummary checks={checks} loading={checksLoading} error={checksError} />
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={pick} disabled={busy || locked} aria-busy={busy || undefined}
        className={`group flex w-full flex-col items-center rounded-[16px] border-[1.5px] border-dashed px-5 py-7 text-center transition-[border-color,background-color] duration-200 sm:py-9 ${hover ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-accent hover:bg-accent-soft/50"}`}>
        <span className={`grid h-12 w-12 place-items-center rounded-[14px] transition-[background-color,color,transform] duration-200 group-active:scale-95 ${hover ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent-text"}`}>{busy ? <Spinner size={22} /> : <Upload size={22} aria-hidden />}</span>
        <span className="mt-3.5 block text-emph font-semibold">{hover ? t("dropRelease") : busy ? t("pkgAnalyzing") : t("dropTitle")}</span>
        <span className="mt-1 block max-w-[34ch] text-small text-muted">{info.mobile ? t("dropHintMobile") : t("dropHint")}</span>
      </button>
      {error && (
        <div role="alert" className="fade-up mt-3 flex gap-2.5 rounded-[14px] bg-err-soft px-4 py-3 text-small">
          <XCircle size={17} className="mt-px shrink-0 text-err" aria-hidden />
          <div className="min-w-0"><p className="font-semibold">{err(error)}</p><p className="mt-0.5 text-muted">{t("pkgErrorNext")}</p>{error.detail && <Details label={t("technicalDetails")}>{error.detail}</Details>}</div>
        </div>
      )}
    </div>
  );
}
