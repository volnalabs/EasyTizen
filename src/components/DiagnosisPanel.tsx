import { AlertTriangle } from "lucide-react";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { DIAGNOSIS_STEPS } from "../lib/tv";
import type { Diagnosis, TvCheck } from "../types";
import { ReadinessList } from "./ReadinessList";
import { Details } from "./ui";

/** Plain-language explanation of what went wrong, what to do, and what was checked. */
export function DiagnosisPanel({ diagnosis, technical, hostIp, check }: { diagnosis: Diagnosis; technical?: string | null; hostIp?: string | null; check?: TvCheck | null }) {
  const { t } = useI18n();
  const params = { hostIp: hostIp ?? check?.host_ip ?? "—", tvHostIp: check?.samsung?.developer_ip ?? "—", ip: check?.ip ?? "—" };
  const steps = DIAGNOSIS_STEPS[diagnosis];
  return (
    <div role="alert" className="fade-up rounded-[12px] border border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-warn-soft p-4">
      <div className="flex gap-3">
        <AlertTriangle size={18} className="mt-px shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t(`dx_${diagnosis}` as Key)}</p>
          <p className="mt-1 text-small text-muted">{t(`dx_${diagnosis}_body` as Key, params)}</p>
          {steps && (
            <ol className="m-0 mt-2.5 list-none space-y-1.5 p-0 text-small">
              {steps.map((k, i) => (
                <li key={k} className="flex gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface text-caption font-semibold text-muted" aria-hidden>{i + 1}</span>
                  <span className="min-w-0 pt-px">{t(k, params)}</span>
                </li>
              ))}
            </ol>
          )}
          {check && <ReadinessList check={check} />}
          {technical && <Details label={t("technicalDetails")}>{technical}</Details>}
        </div>
      </div>
    </div>
  );
}
