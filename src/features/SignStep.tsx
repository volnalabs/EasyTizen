import { KeyRound, Plus, Upload } from "lucide-react";
import { useState } from "react";
import { useApp } from "../app/context";
import { Button, Notice, Toggle } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { daysLeft, formatDate } from "../lib/format";
import { isTizenProfile, prefersOriginalSignature } from "../lib/tv";
import type { CertificateProfile, TvInfo } from "../types";
import { CreateCertificateDialog, ImportCertificateDialog } from "./CertDialogs";

/** Step "Signature": install as is, or sign with one of the certificates that fit this TV. */
export function SignStep({ tv, alreadySigned, resign, onResign, profiles, profile, onProfile, legacy, tizenFirst, locked }: {
  tv: TvInfo; alreadySigned: boolean; resign: boolean; onResign: (v: boolean) => void;
  profiles: CertificateProfile[]; profile: string; onProfile: (name: string) => void;
  legacy: boolean; tizenFirst: boolean; locked: boolean;
}) {
  const { t, lang } = useI18n();
  const { go } = useApp();
  const [dialog, setDialog] = useState<"create" | "import" | null>(null);
  const willSign = resign || !alreadySigned;

  return (
    <div className="space-y-4">
      {alreadySigned && (
        <Toggle checked={resign} onChange={onResign} disabled={locked} label={t("installResign")}
          description={prefersOriginalSignature(tv.tizen_version, alreadySigned) ? t("installResignHintOldTv", { tizen: tv.tizen_version ?? "" }) : t("installResignHint")} />
      )}
      {!willSign && <p className="text-small text-muted">{t("signAsIs")}</p>}

      {willSign && !tv.duid && !tizenFirst && <Notice tone="warn" title={t("tvNoDuidTitle")}>{t("tvNoDuid")}</Notice>}

      {willSign && (tv.duid || tizenFirst) && (profiles.length > 0 ? (
        <div>
          <p className="mb-2 text-small font-semibold" id="sign-cert-label">{t("installCert")}</p>
          <div role="radiogroup" aria-labelledby="sign-cert-label" className="space-y-2">
            {profiles.map((p) => {
              const on = p.name === profile;
              const days = daysLeft(p.expires_at);
              return (
                <label key={p.name} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-control border px-3.5 py-2.5 transition-[border-color,background-color] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${on ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-fill"} ${locked ? "pointer-events-none opacity-60" : ""}`}>
                  <input type="radio" name="sign-cert" className="sr-only" checked={on} disabled={locked} onChange={() => onProfile(p.name)} />
                  <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${on ? "border-accent" : "border-line-strong"}`}>
                    <span className={`h-2.5 w-2.5 rounded-full bg-accent transition-transform duration-150 ${on ? "scale-100" : "scale-0"}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold break-words">{p.name}</span>
                    <span className="block text-caption text-muted">
                      {isTizenProfile(p) ? t("certKindTizenShort") : t("certKindSamsungShort")}
                      {!isTizenProfile(p) && p.expires_at != null && days != null && ` · ${t("certValidUntilShort", { date: formatDate(p.expires_at, lang) })}`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <Button variant="link" size="sm" className="-ms-1 mt-2" disabled={locked} onClick={() => setDialog("create")} icon={<Plus size={15} aria-hidden />}>{t("signAnother")}</Button>
        </div>
      ) : (
        <div>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-text"><KeyRound size={19} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t("installCertNone")}</p>
              <p className="mt-0.5 text-small text-muted">{legacy ? t("installCertLegacy") : tizenFirst ? t("installCertNoneBodyTizen", { tizen: tv.tizen_version ?? "" }) : t("installCertNoneBody")}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" className="flex-[1_1_12rem] sm:flex-none" disabled={locked} onClick={() => setDialog("create")} icon={<KeyRound size={16} aria-hidden />}>{t("installCertCreate")}</Button>
            <Button className="flex-[1_1_10rem] sm:flex-none" disabled={locked} onClick={() => setDialog("import")} icon={<Upload size={16} aria-hidden />}>{t("installCertImport")}</Button>
            {legacy && <Button variant="ghost" onClick={() => go("certs")}>{t("certTransferOpen")}</Button>}
          </div>
        </div>
      ))}

      {dialog === "create" && <CreateCertificateDialog preselectDuid={tv.duid} tizenVersion={tv.tizen_version} onClose={() => setDialog(null)} onCreated={(p) => { setDialog(null); onProfile(p.name); }} />}
      {dialog === "import" && <ImportCertificateDialog onClose={() => setDialog(null)} onImported={(p) => { setDialog(null); onProfile(p.name); }} />}
    </div>
  );
}
