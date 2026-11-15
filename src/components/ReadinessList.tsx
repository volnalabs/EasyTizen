import { Check, CircleHelp, X } from "lucide-react";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { readiness } from "../lib/tv";
import type { TvCheck } from "../types";

/** What was checked for one TV address: met, not met, or not determinable. */
export function ReadinessList({ check }: { check: TvCheck }) {
  const { t } = useI18n();
  const items = readiness(check);
  return (
    <div className="mt-3">
      <p className="eyebrow mb-1.5">{t("ckTitle")}</p>
      <ul className="m-0 list-none space-y-1.5 p-0 text-small" aria-label={t("ckTitle")}>
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2">
            <span className={`mt-px grid h-[1.125rem] w-[1.125rem] shrink-0 place-items-center rounded-full ${item.state === "ok" ? "bg-ok-soft text-ok" : item.state === "fail" ? "bg-err-soft text-err" : "bg-surface-2 text-muted"}`} aria-hidden>
              {item.state === "ok" ? <Check size={12} strokeWidth={3} /> : item.state === "fail" ? <X size={12} strokeWidth={3} /> : <CircleHelp size={12} />}
            </span>
            <span className={`min-w-0 break-words ${item.state === "unknown" ? "text-muted" : ""}`}>
              {t(item.key as Key, item.params)}
              <span className="sr-only"> — {t(`ckState_${item.state}` as Key)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
