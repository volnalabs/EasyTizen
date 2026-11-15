import { ArrowRightLeft, KeyRound, Plus, ShieldAlert, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useApp } from "../app/context";
import { ListItem, SplitView, useSplit } from "../components/SplitView";
import { Button, DataList, DialogCancel, EmptyState, Field, Modal, PageHeader, Pill, Row, useToast, type Tone } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { daysLeft, formatDate } from "../lib/format";
import { isTizenProfile } from "../lib/tv";
import { api, toApiError } from "../services/api";
import type { CertificateProfile } from "../types";
import { CreateCertificateDialog, ImportCertificateDialog } from "./CertDialogs";

/** One-time move of a profile that an older version kept in the Tizen SDK keystore. */
function TransferDialog({ profile, onClose, onDone }: { profile: CertificateProfile; onClose: () => void; onDone: () => void }) {
  const { t, err } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const transfer = async () => {
    if (!password) return;
    setBusy(true); setError(null);
    try { await api.transferLegacyCertificate(profile.name, password); onDone(); }
    catch (e) { setError(err(toApiError(e))); }
    finally { setBusy(false); setPassword(""); }
  };
  return (
    <Modal title={t("certTransferTitle")} onClose={onClose}
      footer={<><DialogCancel>{t("cancel")}</DialogCancel><Button variant="primary" busy={busy} disabled={!password} onClick={() => void transfer()}>{t("certTransfer")}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void transfer(); }} className="space-y-3">
        <p className="text-muted">{t("certTransferBody", { name: profile.name })}</p>
        <Field label={t("passwordLabel")} error={error}>
          <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" aria-invalid={!!error} enterKeyHint="done" />
        </Field>
        <p className="text-small text-muted">{t("certTransferImportHint")}</p>
      </form>
    </Modal>
  );
}

/** Validity of a profile as a tone and a short word. */
function useValidity() {
  const { t, lang } = useI18n();
  return (p: CertificateProfile): { tone: Tone; text: string } => {
    const days = daysLeft(p.expires_at);
    const tizen = isTizenProfile(p);
    if (p.engine === "sdk") return { tone: "warn", text: t("certLegacy") };
    // A Tizen certificate is not refused by EasyTizen once its date passes: older TVs do not check it.
    if (tizen && days != null && days < 0) return { tone: "warn", text: t("certTizenDatePassed") };
    if (!tizen && days != null && days < 0) return { tone: "err", text: t("certExpired", { date: formatDate(p.expires_at!, lang) }) };
    if (days != null && days <= 30) return { tone: "warn", text: t("certExpiresSoon", { days }) };
    return { tone: "ok", text: t("certValid") };
  };
}

function CertDetail({ profile, onTransfer, onRemove }: { profile: CertificateProfile; onTransfer: () => void; onRemove: () => void }) {
  const { t, lang } = useI18n();
  const { settings } = useApp();
  const validity = useValidity()(profile);
  const tizen = isTizenProfile(profile);
  const tvName = (duid: string) => settings.devices.find((d) => d.duid?.toLowerCase() === duid.toLowerCase())?.name ?? t("certUnknownTv", { tail: duid.slice(-4) });
  return (
    <article className="panel fade-up p-5 sm:p-6" aria-labelledby="cert-detail-name">
      <div className="flex items-start gap-4">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] ${validity.tone === "err" ? "bg-err-soft text-err" : "bg-accent-soft text-accent-text"}`}>
          {validity.tone === "err" ? <ShieldAlert size={22} aria-hidden /> : <ShieldCheck size={22} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="cert-detail-name" className="selectable text-title font-semibold tracking-[-0.015em] break-words">{profile.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill tone={validity.tone}>{validity.text}</Pill>
            <Pill tone="neutral">{t(tizen ? "certKindTizenShort" : "certKindSamsungShort")}</Pill>
            {profile.imported && <Pill tone="neutral">{t("certImported")}</Pill>}
          </div>
        </div>
      </div>
      <DataList className="mt-5 border-t border-line">
        <Row label={t("certAuthor")}>{profile.identity}</Row>
        <Row label={t("certTvs")}>{tizen ? t("certTizenAnyTv") : profile.duids.map(tvName).join(", ")}</Row>
        {profile.expires_at != null && <Row label={t("certValidUntil")}>{formatDate(profile.expires_at, lang)}</Row>}
        {profile.created_at != null && <Row label={t("certCreatedAt")}>{formatDate(profile.created_at, lang)}</Row>}
      </DataList>
      {profile.engine === "sdk" && (
        <div className="mt-4 rounded-[14px] bg-warn-soft p-4">
          <p className="text-small">{t("certLegacyBody")}</p>
          <Button size="sm" variant="primary" className="mt-3" onClick={onTransfer} icon={<ArrowRightLeft size={14} aria-hidden />}>{t("certTransfer")}</Button>
        </div>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <Button variant="ghost" size="sm" className="-ms-2 text-err hover:bg-err-soft hover:text-err" onClick={onRemove} icon={<Trash2 size={15} aria-hidden />}>{t("certRemove")}</Button>
      </div>
    </article>
  );
}

export function CertificatesPage() {
  const { t, err } = useI18n();
  const { settings, refresh, tv } = useApp();
  const toast = useToast();
  const split = useSplit();
  const validity = useValidity();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "import" | null>(null);
  const [removing, setRemoving] = useState<CertificateProfile | null>(null);
  const [transferring, setTransferring] = useState<CertificateProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const profiles = settings.certificate_profiles;
  const chosen = profiles.find((p) => p.name === selected) ?? (split ? profiles[0] : undefined);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.removeCertificate(removing.name); await refresh(); toast("ok", t("certRemoved")); setRemoving(null); setSelected(null); }
    catch (e) { toast("err", err(toApiError(e))); }
    finally { setBusy(false); }
  };
  const actions = (
    <>
      <Button onClick={() => setDialog("import")} icon={<Upload size={16} aria-hidden />}>{t("certsImport")}</Button>
      <Button variant="primary" onClick={() => setDialog("create")} icon={<Plus size={16} aria-hidden />}>{t("certsCreate")}</Button>
    </>
  );

  return (
    <div>
      {/* On a phone the open detail replaces the list, header included. */}
      {(split || !chosen) && <PageHeader title={t("certsTitle")} subtitle={t("certsSubtitle")} action={profiles.length > 0 ? actions : undefined} />}
      {profiles.length === 0 ? (
        <EmptyState icon={<KeyRound size={28} aria-hidden />} title={t("certsEmptyTitle")} body={t("certsEmptyBody")} action={actions} />
      ) : (
        <SplitView open={!!chosen} onBack={() => setSelected(null)} backLabel={t("certsTitle")}
          list={(
            <ul className="panel m-0 list-none divide-y divide-line overflow-hidden p-0" aria-label={t("certsTitle")}>
              {profiles.map((p) => {
                const v = validity(p);
                return (
                  <ListItem key={p.name} selected={chosen?.name === p.name} onSelect={() => setSelected(p.name)}
                    leading={<span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] ${v.tone === "err" ? "bg-err-soft text-err" : "bg-accent-soft text-accent-text"}`}><ShieldCheck size={19} aria-hidden /></span>}
                    title={p.name}
                    meta={<>{t(isTizenProfile(p) ? "certKindTizenShort" : "certKindSamsungShort")} · <span className={v.tone === "ok" ? "" : v.tone === "err" ? "text-err" : "text-warn"}>{v.text}</span></>} />
                );
              })}
            </ul>
          )}
          detail={chosen && <CertDetail key={chosen.name} profile={chosen} onTransfer={() => setTransferring(chosen)} onRemove={() => setRemoving(chosen)} />} />
      )}
      {dialog === "create" && <CreateCertificateDialog preselectDuid={tv?.duid} tizenVersion={tv?.tizen_version} onClose={() => setDialog(null)} onCreated={(p) => { setDialog(null); setSelected(p.name); }} />}
      {dialog === "import" && <ImportCertificateDialog onClose={() => setDialog(null)} onImported={(p) => { setDialog(null); setSelected(p.name); }} />}
      {transferring && <TransferDialog profile={transferring} onClose={() => setTransferring(null)} onDone={() => { setTransferring(null); void refresh(); toast("ok", t("certTransferred")); }} />}
      {removing && (
        <Modal title={t("certRemoveTitle")} onClose={() => setRemoving(null)}
          footer={<><DialogCancel>{t("cancel")}</DialogCancel><Button variant="danger" busy={busy} onClick={() => void remove()}>{t("remove")}</Button></>}>
          <p>{t("certRemoveConfirm", { name: removing.name })}</p>
        </Modal>
      )}
    </div>
  );
}
