import { KeyRound, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useApp } from "../app/context";
import { Button, DataList, EmptyState, IconButton, IconTile, Modal, PageHeader, Pill, Row, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { daysLeft, formatDate } from "../lib/format";
import { api, toApiError } from "../services/api";
import type { CertificateProfile } from "../types";
import { CreateCertificateDialog, ImportCertificateDialog } from "./CertDialogs";

export function CertificatesPage() {
  const { t, lang, err } = useI18n();
  const { settings, refresh, info, tv } = useApp();
  const toast = useToast();
  const [dialog, setDialog] = useState<"create" | "import" | null>(null);
  const [removing, setRemoving] = useState<CertificateProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const engine = info.mobile ? "builtin" : settings.engine;

  const tvName = (duid: string) => settings.devices.find((d) => d.duid?.toLowerCase() === duid.toLowerCase())?.name ?? t("certUnknownTv", { tail: duid.slice(-4) });
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.removeCertificate(removing.name); await refresh(); toast("ok", t("certRemoved")); setRemoving(null); }
    catch (e) { toast("err", err(toApiError(e))); }
    finally { setBusy(false); }
  };
  const actions = (
    <>
      <Button onClick={() => setDialog("import")}><Upload size={16} aria-hidden />{t("certsImport")}</Button>
      <Button variant="primary" onClick={() => setDialog("create")}><Plus size={16} aria-hidden />{t("certsCreate")}</Button>
    </>
  );

  return (
    <div>
      <PageHeader title={t("certsTitle")} subtitle={t("certsSubtitle")} action={settings.certificate_profiles.length > 0 ? actions : undefined} />
      {settings.certificate_profiles.length === 0 ? (
        <EmptyState icon={<KeyRound size={26} aria-hidden />} title={t("certsEmptyTitle")} body={t("certsEmptyBody")} action={actions} />
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {settings.certificate_profiles.map((p) => {
            const days = daysLeft(p.expires_at);
            const other = p.engine !== engine;
            const expired = days != null && days < 0;
            return (
              <li key={p.name} className={`card fade-up p-4 sm:p-5 ${other ? "opacity-75" : ""}`}>
                <div className="flex items-start gap-3">
                  <IconTile tone={expired ? "err" : "accent"}><ShieldCheck size={20} aria-hidden /></IconTile>
                  <div className="min-w-0 flex-1">
                    <p className="selectable data text-emph font-semibold">{p.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {expired ? <Pill tone="err">{t("certExpired", { date: formatDate(p.expires_at!, lang) })}</Pill>
                        : days != null && days <= 30 ? <Pill tone="warn">{t("certExpiresSoon", { days })}</Pill>
                          : <Pill tone="ok">{t("certValid")}</Pill>}
                      {!info.mobile && <Pill tone="neutral">{p.engine === "sdk" ? t("certEngineSdk") : t("certEngineBuiltin")}</Pill>}
                      {p.imported && <Pill tone="neutral">{t("certImported")}</Pill>}
                    </div>
                  </div>
                  <IconButton label={t("certRemoveNamed", { name: p.name })} onClick={() => setRemoving(p)}><Trash2 size={16} aria-hidden /></IconButton>
                </div>
                <DataList className="mt-3 border-t border-line">
                  <Row label={t("certAuthor")}>{p.identity}</Row>
                  <Row label={t("certTvs")}>{p.duids.map(tvName).join(", ")}</Row>
                  {p.expires_at != null && <Row label={t("certValidUntil")}>{formatDate(p.expires_at, lang)}</Row>}
                </DataList>
                {other && <p className="mt-2 text-small text-warn">{t("certOtherEngine")}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {dialog === "create" && <CreateCertificateDialog preselectDuid={tv?.duid} onClose={() => setDialog(null)} onCreated={() => setDialog(null)} />}
      {dialog === "import" && <ImportCertificateDialog onClose={() => setDialog(null)} onImported={() => setDialog(null)} />}
      {removing && (
        <Modal title={t("certRemoveTitle")} onClose={() => setRemoving(null)}
          footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>{t("cancel")}</Button><Button variant="danger" busy={busy} onClick={() => void remove()}>{t("remove")}</Button></>}>
          <p>{t("certRemoveConfirm", { name: removing.name })}</p>
        </Modal>
      )}
    </div>
  );
}
