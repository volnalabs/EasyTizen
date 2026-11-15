import { ExternalLink, FileArchive, FileKey, KeyRound, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Button, Details, DialogCancel, Field, Modal, Notice, PasswordInput, Progress, Toggle, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { opId, passwordProblem, validProfileName } from "../lib/format";
import { prefersTizenCertificate } from "../lib/tv";
import { api, on, pickFile, toApiError } from "../services/api";
import type { ApiError, CertKind, CertProgress, CertStage, CertificateProfile } from "../types";

const SAMSUNG_STAGES: CertStage[] = ["signin", "author", "distributor", "saving"];
const TIZEN_STAGES: CertStage[] = ["download", "author", "saving"];

function uniqueName(base: string, taken: { name: string }[]): string {
  let name = base;
  let n = 2;
  while (taken.some((p) => p.name === name)) name = `${base}-${n++}`;
  return name;
}

/**
 * Create a certificate profile. Two kinds:
 * - Tizen certificate: the Tizen SDK's own developer certificate, no Samsung account and no DUID — for TVs before Tizen 7;
 * - Samsung certificate: issued by Samsung after sign-in for specific TVs — needed from Tizen 7 on.
 * The default follows the TV's Tizen version.
 */
export function CreateCertificateDialog({ preselectDuid, tizenVersion, onClose, onCreated }: {
  preselectDuid?: string | null; tizenVersion?: string | null; onClose: () => void; onCreated: (p: CertificateProfile) => void;
}) {
  const { t, err } = useI18n();
  const { settings, refresh, setBusy: markBusy, info } = useApp();
  const toast = useToast();
  const tvs = useMemo(() => settings.devices.filter((d) => !!d.duid), [settings.devices]);
  const [selected, setSelected] = useState<string[]>(() => {
    const first = preselectDuid && tvs.some((d) => d.duid === preselectDuid) ? preselectDuid : tvs[0]?.duid;
    return first ? [first] : [];
  });
  const knownVersion = tizenVersion ?? settings.devices.find((d) => d.duid && d.duid === preselectDuid)?.tizen_version ?? null;
  const [kind, setKind] = useState<CertKind>(() => {
    if (knownVersion) return prefersTizenCertificate(knownVersion) ? "tizen" : "samsung";
    // No TV yet: the Tizen certificate needs none; otherwise follow the first saved TV.
    const first = settings.devices[0]?.tizen_version;
    return tvs.length === 0 || prefersTizenCertificate(first) ? "tizen" : "samsung";
  });
  const [packageFile, setPackageFile] = useState<string | null>(null);
  const suggestion = useMemo(() => {
    if (kind === "tizen") return uniqueName("Tizen", settings.certificate_profiles);
    const tv = tvs.find((d) => d.duid === selected[0]);
    return uniqueName(`EasyTizen-${tv?.ip.split(".").at(-1) ?? "TV"}`, settings.certificate_profiles);
  }, [kind, tvs, selected, settings.certificate_profiles]);
  const [name, setName] = useState(suggestion);
  const nameEdited = useRef(false);
  useEffect(() => { if (!nameEdited.current) setName(suggestion); }, [suggestion]);
  const [identity, setIdentity] = useState("EasyTizen User");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<CertStage | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [touched, setTouched] = useState(false);
  const op = useRef<string | null>(null);

  useEffect(() => { markBusy("certificate", busy); return () => markBusy("certificate", false); }, [busy, markBusy]);
  useEffect(() => {
    const off = on<CertProgress>("cert-progress", (p) => { if (p.op_id === op.current) { setStage(p.stage); if (p.url) setUrl(p.url); } });
    return () => { void off.then((f) => f()); };
  }, []);

  const nameError = touched && !validProfileName(name.trim()) ? t("certInvalidProfile") : null;
  const passwordError = touched && passwordProblem(password) ? t("certPasswordWeak") : null;
  const confirmError = touched && password !== confirm ? t("certPasswordMismatch") : null;
  const valid = (kind === "tizen" || selected.length > 0) && validProfileName(name.trim()) && identity.trim().length >= 2 && !passwordProblem(password) && password === confirm;

  const create = async () => {
    setTouched(true);
    if (!valid) return;
    const id = opId();
    op.current = id;
    setBusy(true); setError(null); setStage(null); setUrl(null);
    try {
      const profile = kind === "tizen"
        ? await api.createTizenCertificate({ profileName: name.trim(), identity: identity.trim(), password, packageSource: packageFile }, id)
        : await api.createCertificate({ profileName: name.trim(), identity: identity.trim(), password, duids: selected }, id);
      await refresh();
      toast("ok", t("certCreated", { name: profile.name }));
      onCreated(profile);
    } catch (e) {
      const parsed = toApiError(e);
      if (parsed.code !== "cancelled") setError(parsed);
    } finally {
      setBusy(false); op.current = null;
    }
  };
  const close = () => { if (busy && op.current) void api.cancel(op.current); onClose(); };

  return (
    <Modal title={t("certCreateTitle")} onClose={close} wide dismissible={!busy}
      footer={busy
        ? <Button onClick={() => op.current && void api.cancel(op.current)}>{t("cancel")}</Button>
        : <><DialogCancel>{t("cancel")}</DialogCancel><Button variant="primary" disabled={kind === "samsung" && tvs.length === 0} onClick={() => void create()} icon={<KeyRound size={16} aria-hidden />}>{t(kind === "tizen" ? "certCreateButtonTizen" : "certCreateButton")}</Button></>}>
      {busy ? (
        <div className="py-6 text-center" aria-live="polite">
          <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-[16px] bg-accent-soft text-accent-text">
            <KeyRound size={24} aria-hidden /><span className="signal absolute -end-1 -top-1 h-3 w-3 rounded-full bg-accent ring-2 ring-surface" aria-hidden />
          </span>
          <p className="mx-auto mt-4 max-w-[34ch] font-semibold">{stage ? t(kind === "tizen" && stage === "author" ? "certStageTizenAuthor" : `certStage_${stage}` as Key) : t("certStageStart")}</p>
          {kind === "samsung" && (stage === "signin" || !stage) && <p className="mx-auto mt-1 max-w-[38ch] text-small text-muted">{t("certReturnHint")}</p>}
          <div className="mx-auto mt-5 max-w-xs"><Progress value={stage ? (Math.max(0, (kind === "tizen" ? TIZEN_STAGES : SAMSUNG_STAGES).indexOf(stage === "reading" ? "download" : stage)) + 1) / ((kind === "tizen" ? TIZEN_STAGES : SAMSUNG_STAGES).length + 1) : null} label={t("certCreateTitle")} /></div>
          {stage === "signin" && url && <Button size="sm" className="mt-5" onClick={() => void api.openExternal(url)} icon={<ExternalLink size={14} aria-hidden />}>{t("certOpenAgain")}</Button>}
        </div>
      ) : (
        <div className="space-y-4">
          <div role="radiogroup" aria-label={t("certKindLabel")} className="grid gap-2 sm:grid-cols-2">
            {(["tizen", "samsung"] as const).map((k) => {
              const on = kind === k;
              const recommended = knownVersion ? prefersTizenCertificate(knownVersion) === (k === "tizen") : false;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setKind(k)}
                  className={`flex min-h-11 flex-col items-start gap-1 rounded-control border px-3.5 py-3 text-start transition-[border-color,background-color] duration-150 ${on ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-fill"}`}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">{t(k === "tizen" ? "certKindTizen" : "certKindSamsung")}
                    {recommended && <span className="rounded-full bg-ok-soft px-2 py-px text-caption font-medium text-ok">{t("certKindRecommended")}</span>}
                  </span>
                  <span className="text-small text-muted">{t(k === "tizen" ? "certKindTizenBody" : "certKindSamsungBody")}</span>
                </button>
              );
            })}
          </div>
          {kind === "samsung" && tvs.length === 0 && <Notice tone="warn">{t("certNeedTv")}</Notice>}
          {kind === "samsung" && tvs.length > 0 && <div>
            <span className="mb-1.5 block text-small font-semibold">{t("certForTvs")}</span>
            <div className="space-y-2">
              {tvs.map((d) => {
                const checked = selected.includes(d.duid!);
                return (
                  <label key={d.duid} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-control border px-3.5 py-2.5 transition-[border-color,background-color] duration-150 ${checked ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-fill"}`}>
                    <input type="checkbox" className="h-[1.125rem] w-[1.125rem] shrink-0 accent-[var(--accent)]" checked={checked} onChange={() => setSelected((s) => (checked ? s.filter((x) => x !== d.duid) : [...s, d.duid!]))} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words">{d.name}</span>
                      <span className="data block text-caption text-muted">{d.ip}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("certProfileName")} hint={t("certProfileHint")} error={nameError}><input className="input" value={name} onChange={(e) => { nameEdited.current = true; setName(e.target.value); }} autoComplete="off" spellCheck={false} aria-invalid={!!nameError} /></Field>
            <Field label={t("certIdentity")} hint={t("certIdentityHint")}><input className="input" value={identity} onChange={(e) => setIdentity(e.target.value)} autoComplete="name" /></Field>
            <Field label={t("certPassword")} error={passwordError}><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-invalid={!!passwordError} /></Field>
            <Field label={t("certPasswordConfirm")} error={confirmError}><PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={!!confirmError} /></Field>
          </div>
          <p className="flex items-start gap-2 text-small text-muted"><LockKeyhole size={15} className="mt-[3px] shrink-0" aria-hidden /><span className="min-w-0">{t("certPasswordHint")}</span></p>
          {kind === "samsung" ? <Notice tone="info">{t("certSamsungNote")}</Notice> : (
            <Notice tone="info">
              <p>{t("certTizenNote")}</p>
              <Details label={t("certTizenOffline")} inline>
                <p className="mb-2.5">{t("certTizenOfflineBody")}</p>
                <button type="button" onClick={async () => { const p = await pickFile(info.mobile ? undefined : ["zip"]); if (p) setPackageFile(p); }} className="input flex items-center gap-2.5 text-start">
                  <FileArchive size={16} className="shrink-0 text-muted" aria-hidden />
                  <span className={`data min-w-0 flex-1 ${packageFile ? "font-medium" : "text-muted"}`} title={packageFile ?? undefined}>{packageFile ? (packageFile.startsWith("content://") ? t("certFileChosen") : packageFile.split(/[\\/]/).pop()) : t("certTizenChooseZip")}</span>
                </button>
                {packageFile && <Button size="sm" variant="ghost" className="mt-2 -ms-2" onClick={() => setPackageFile(null)}>{t("certTizenUseDownload")}</Button>}
              </Details>
            </Notice>
          )}
          {error && <Notice tone="err" title={err(error)}>{error.detail && <Details label={t("technicalDetails")}>{error.detail}</Details>}</Notice>}
        </div>
      )}
    </Modal>
  );
}

/** Import an author + distributor pair created elsewhere (e.g. Tizen Studio). */
export function ImportCertificateDialog({ onClose, onImported }: { onClose: () => void; onImported: (p: CertificateProfile) => void }) {
  const { t, err } = useI18n();
  const { refresh, info } = useApp();
  const toast = useToast();
  const [name, setName] = useState("Imported-1");
  const [author, setAuthor] = useState<string | null>(null);
  const [distributor, setDistributor] = useState<string | null>(null);
  const [authorPassword, setAuthorPassword] = useState("");
  const [distributorPassword, setDistributorPassword] = useState("");
  const [same, setSame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const pick = async (set: (v: string) => void) => { const p = await pickFile(info.mobile ? undefined : ["p12", "pfx"]); if (p) set(p); };
  const valid = validProfileName(name.trim()) && !!author && !!distributor && !!authorPassword && (same || !!distributorPassword);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const profile = await api.importCertificate({ profileName: name.trim(), authorSource: author!, distributorSource: distributor!, authorPassword, distributorPassword: same ? authorPassword : distributorPassword });
      await refresh();
      toast("ok", t("certImportedOk", { name: profile.name }));
      onImported(profile);
    } catch (e) { setError(toApiError(e)); }
    finally { setBusy(false); }
  };
  const fileButton = (value: string | null, set: (v: string) => void) => (
    <button type="button" onClick={() => pick(set)} className="input flex items-center gap-2.5 text-start">
      <FileKey size={16} className="shrink-0 text-muted" aria-hidden />
      <span className={`data min-w-0 flex-1 ${value ? "font-medium" : "text-muted"}`} title={value ?? undefined}>{value ? (value.startsWith("content://") ? t("certFileChosen") : value.split(/[\\/]/).pop()) : t("certChooseFile")}</span>
    </button>
  );

  return (
    <Modal title={t("certImportTitle")} onClose={onClose} wide
      footer={<><DialogCancel>{t("cancel")}</DialogCancel><Button variant="primary" busy={busy} disabled={!valid} onClick={() => void run()}>{t("certImportButton")}</Button></>}>
      <div className="space-y-4">
        <p className="text-muted">{t("certImportBody")}</p>
        <Field label={t("certProfileName")} hint={t("certProfileHint")} error={!validProfileName(name.trim()) ? t("certInvalidProfile") : null}><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("certAuthorFile")}>{fileButton(author, setAuthor)}</Field>
          <Field label={t("certFilePassword")}><PasswordInput value={authorPassword} onChange={(e) => setAuthorPassword(e.target.value)} autoComplete="off" /></Field>
          <Field label={t("certDistributorFile")}>{fileButton(distributor, setDistributor)}</Field>
          {!same && <Field label={t("certFilePassword")}><PasswordInput value={distributorPassword} onChange={(e) => setDistributorPassword(e.target.value)} autoComplete="off" /></Field>}
        </div>
        <Toggle checked={same} onChange={setSame} label={t("certSamePassword")} />
        {error && <Notice tone="err" title={err(error)}>{error.detail && <Details label={t("technicalDetails")}>{error.detail}</Details>}</Notice>}
      </div>
    </Modal>
  );
}
