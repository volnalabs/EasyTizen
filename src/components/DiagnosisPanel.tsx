import { AlertTriangle } from "lucide-react";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import type { Diagnosis } from "../types";
import { Details } from "./ui";

const CHECKS: Partial<Record<Diagnosis, Key[]>> = {
  tv_unreachable: ["dx_tv_unreachable_c1", "dx_tv_unreachable_c2", "dx_tv_unreachable_c3"],
  port_closed: ["dx_port_closed_c1", "dx_port_closed_c2", "dx_port_closed_c3"],
};

/** Plain-language explanation of what went wrong, with concrete things to check. */
export function DiagnosisPanel({ diagnosis, technical, hostIp }: { diagnosis: Diagnosis; technical?: string | null; hostIp?: string | null }) {
  const { t } = useI18n();
  const params = { hostIp: hostIp ?? "—" };
  return (
    <div role="alert" className="fade-up rounded-[12px] border border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-warn-soft p-4">
      <div className="flex gap-3">
        <AlertTriangle size={18} className="mt-px shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t(`dx_${diagnosis}` as Key)}</p>
          <p className="mt-1 text-small text-muted">{t(`dx_${diagnosis}_body` as Key, params)}</p>
          {CHECKS[diagnosis] && (
            <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0 text-small">
              {CHECKS[diagnosis]!.map((k) => <li key={k} className="flex gap-2"><span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-warn" aria-hidden /><span className="min-w-0">{t(k, params)}</span></li>)}
            </ul>
          )}
          {technical && <Details label={t("technicalDetails")}>{technical}</Details>}
        </div>
      </div>
    </div>
  );
}
