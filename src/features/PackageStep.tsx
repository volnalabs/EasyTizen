import { CheckCircle2, CircleAlert, FileArchive, Lock, ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestion, UploadCloud, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../app/context";
import { Button, DataList, IconTile, Pill, Row, Spinner } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { hasKey } from "../i18n";
import { formatBytes } from "../lib/format";
import { api, inTauri, pickFile, toApiError } from "../services/api";
import type { ApiError, CheckCode, ExtraChecks, OpenedPackage, SignatureState } from "../types";

const SIG_TONE: Record<SignatureState, "ok" | "warn" | "err" | "neutral"> = { signed_structure: "ok", unsigned: "neutral", partial: "warn", malformed: "err" };
const CHECK_ORDER: CheckCode[] = ["app_id", "entry_point", "native_code", "duplicates", "signature"];

/** Result of the two check layers: mandatory file safety (always) and the additional checks. */
export function ChecksPanel({ checks, loading, error }: { checks: ExtraChecks | null; loading: boolean; error: string | null }) {
  const { t, err } = useI18n();
  const { go } = useApp();
  const failed = checks?.findings.filter((f) => f.blocking) ?? [];
  return (
    <div className="mt-4 rounded-[12px] border border-line" aria-label={t("checksTitle")} role="group">
      <p className="eyebrow border-b border-line px-4 py-2.5">{t("checksTitle")}</p>
      <ul className="m-0 list-none divide-y divide-line p-0">
        <li className="flex gap-3 px-4 py-3">
          <Lock size={18} className="mt-px shrink-0 text-ok" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("checksMandatory")} <span className="font-normal text-ok">· {t("checksPassed")}</span></p>
            <p className="mt-0.5 text-small text-muted">{t("checksMandatoryBody")}</p>
          </div>
        </li>
        <li className="flex gap-3 px-4 py-3">
          {loading ? <Spinner size={18} className="mt-px text-muted" />
            : !checks?.enabled ? <ShieldOff size={18} className="mt-px shrink-0 text-warn" aria-hidden />
              : failed.length ? <ShieldAlert size={18} className="mt-px shrink-0 text-err" aria-hidden />
                : <ShieldCheck size={18} className="mt-px shrink-0 text-ok" aria-hidden />}
          <div className="min-w-0 flex-1">
            {loading ? <p className="font-semibold">{t("checksExtra")} <span className="font-normal text-muted">· {t("checksRunning")}</span></p>
              : error ? <p className="font-semibold">{t("checksExtra")} <span className="font-normal text-err">· {err(error)}</span></p>
                : !checks?.enabled ? (
                  <>
                    <p className="font-semibold">{t("checksExtra")} <span className="font-normal text-warn">· {t("checksOff")}</span></p>
                    <p className="mt-0.5 text-small text-muted">{t("checksOffBody")}</p>
                    <Button variant="link" size="sm" className="-ml-1 mt-1" onClick={() => go("settings")}>{t("checksOpenSettings")}</Button>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">{t("checksExtra")} <span className={`font-normal ${failed.length ? "text-err" : "text-ok"}`}>· {failed.length ? t("checksFailed", { n: failed.length }) : t("checksExtraPassed")}</span></p>
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
    </div>
  );
}

export function PackageStep({ pkg, onPackage, checks, checksLoading, checksError }: {
  pkg: OpenedPackage | null; onPackage: (p: OpenedPackage | null) => void;
  checks: ExtraChecks | null; checksLoading: boolean; checksError: string | null;
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
    if (!inTauri || info.mobile) return;
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
  }, [open, info.mobile]);

  // Android pickers cannot filter by the .wgt extension; the backend checks the content.
  const pick = async () => { const p = await pickFile(info.mobile ? undefined : ["wgt"], t("dropTitle")); if (p) await open(p); };

  if (pkg) {
    const r = pkg.report;
    const SigIcon = r.signature === "signed_structure" ? ShieldCheck : r.signature === "malformed" ? ShieldAlert : ShieldQuestion;
    return (
      <div className="fade-up">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <IconTile><FileArchive size={20} aria-hidden /></IconTile>
          <div className="min-w-0 flex-[1_1_10rem]">
            <p className="text-emph font-semibold break-words">{r.app_name ?? r.file_name}</p>
            <p className="data text-small text-muted">{r.file_name}</p>
          </div>
          <Button size="sm" onClick={() => onPackage(null)}>{t("pkgClear")}</Button>
        </div>
        <DataList className="mt-3 border-t border-line">
          {r.version && <Row label={t("pkgVersion")} data>{r.version}</Row>}
          {r.app_id && <Row label={t("pkgId")} data>{r.app_id}</Row>}
          <Row label={t("pkgSize")}>{formatBytes(r.size_bytes, lang)} · {t("pkgFilesCount", { n: r.entry_count })}</Row>
          {r.required_api_version && <Row label={t("pkgApi")} data>{r.required_api_version}</Row>}
          <Row label={t("pkgSignature")}><Pill tone={SIG_TONE[r.signature]}><SigIcon size={12} aria-hidden />{t(`sig_${r.signature}` as Key)}</Pill></Row>
        </DataList>
        <p className="mt-2 text-small text-muted">{t(`sigNote_${r.signature}` as Key)}</p>
        {checks && !checks.enabled && r.warnings.map((w) => { const k = `warn_${w.code}`; return hasKey(k) ? <p key={w.code} className="mt-2 flex gap-2 text-small text-warn"><CircleAlert size={15} className="mt-[3px] shrink-0" aria-hidden />{t(k)}</p> : null; })}
        <ChecksPanel checks={checks} loading={checksLoading} error={checksError} />
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={pick} disabled={busy} aria-busy={busy || undefined}
        className={`grid w-full place-items-center rounded-[12px] border-[1.5px] border-dashed px-5 py-8 text-center transition-colors sm:py-10 ${hover ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent hover:bg-surface-2"}`}>
        <span className={`grid h-12 w-12 place-items-center rounded-[14px] transition-colors ${hover ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent-text"}`}>{busy ? <Spinner size={22} /> : <UploadCloud size={24} aria-hidden />}</span>
        <span className="mt-3 block text-emph font-semibold">{hover ? t("dropRelease") : busy ? t("pkgAnalyzing") : t("dropTitle")}</span>
        <span className="mt-1 block max-w-[34ch] text-muted">{info.mobile ? t("dropHintMobile") : t("dropHint")}</span>
        <span className="mt-3 inline-flex items-center gap-1.5 text-caption text-muted"><Lock size={12} aria-hidden />{t("dropFormats")}</span>
      </button>
      {error && (
        <div role="alert" className="mt-3 flex gap-2 text-small text-err">
          <XCircle size={16} className="mt-[2px] shrink-0" aria-hidden />
          <div className="min-w-0"><p className="font-medium">{err(error)}</p>{error.detail && <p className="data mt-0.5 text-muted">{error.detail}</p>}</div>
        </div>
      )}
    </div>
  );
}
