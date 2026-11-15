import { ArrowLeft, ChevronRight } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useMediaQuery } from "./ui";

/** Wide layout (≥ 1024 px): list and detail side by side. */
export const useSplit = () => useMediaQuery("(min-width: 64rem)");

/**
 * Master–detail. From 1024 px the list and the selected item sit side by side; below that the
 * list fills the screen and choosing an item opens its detail with a back button.
 */
export function SplitView({ list, detail, open, onBack, backLabel }: { list: ReactNode; detail: ReactNode; open: boolean; onBack: () => void; backLabel: string }) {
  const split = useSplit();
  // Opening or leaving a detail on a phone starts at the top, like a new screen.
  useEffect(() => { if (!split) document.getElementById("main")?.scrollTo({ top: 0 }); }, [open, split]);
  if (split) {
    return (
      <div className="grid grid-cols-[minmax(0,21rem)_minmax(0,1fr)] items-start gap-8">
        <div>{list}</div>
        <div className="sticky top-8">{detail}</div>
      </div>
    );
  }
  if (!open) return <>{list}</>;
  return (
    <div className="page-in">
      <button type="button" onClick={onBack} className="-ms-2 mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-control px-2 font-medium text-muted transition-colors hover:bg-fill hover:text-fg">
        <ArrowLeft size={18} aria-hidden />{backLabel}
      </button>
      {detail}
    </div>
  );
}

/** A selectable row of a master list. */
export function ListItem({ selected, onSelect, leading, title, meta, trailing, label }: {
  selected: boolean; onSelect: () => void; leading: ReactNode; title: ReactNode; meta?: ReactNode; trailing?: ReactNode; label?: string;
}) {
  const split = useSplit();
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={split && selected ? "true" : undefined} aria-label={label}
        className={`flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors ${split && selected ? "bg-accent-soft" : "row-btn"}`}>
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold break-words">{title}</span>
          {meta && <span className="mt-0.5 block text-caption text-muted">{meta}</span>}
        </span>
        {trailing}
        {!split && <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />}
      </button>
    </li>
  );
}
