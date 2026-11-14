import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Info, Loader2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../hooks/i18n";

/* EasyTizen UI kit. Visual rules live in docs/DESIGN-SYSTEM.md; colours, radii, type and
   elevation come from the tokens in styles/index.css. */

export type Tone = "ok" | "warn" | "err" | "neutral" | "accent";
const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", err: "text-err", neutral: "text-muted", accent: "text-accent-text" };
const TONE_SOFT: Record<Tone, string> = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", err: "bg-err-soft text-err", neutral: "bg-surface-2 text-muted", accent: "bg-accent-soft text-accent-text" };

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";

export function Button({ variant = "secondary", busy, size = "md", block, className = "", children, disabled, type = "button", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: "sm" | "md" | "lg"; block?: boolean }) {
  return (
    <button type={type} className={`btn btn-${size} btn-${variant} ${block ? "w-full" : ""} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Loader2 size={size === "lg" ? 18 : 16} className="spin" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={`icon-btn ${className}`} {...rest}>{children}</button>;
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`spin shrink-0 ${className}`} aria-hidden />;
}

/** Single choice among 2–4 short options. `stretch` fills the row (phones, settings). */
export function Segmented<T extends string>({ value, options, onChange, label, stretch }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; stretch?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={`${stretch ? "flex w-full" : "inline-flex max-w-full"} gap-0.5 rounded-control bg-surface-2 p-[3px]`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`min-h-8 min-w-0 rounded-[8px] px-2.5 py-1 text-small leading-tight transition-[background-color,color,box-shadow] duration-150 sm:px-3 ${stretch ? "flex-[1_1_auto]" : ""} ${on ? "bg-surface font-semibold text-fg shadow-raised" : "font-medium text-muted hover:text-fg"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Track({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 ${checked ? "bg-accent" : "bg-surface-3"}`}>
      <span className={`absolute inset-y-0.5 left-0.5 grid aspect-square place-items-center rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-200 ${checked ? "translate-x-4" : ""}`}>
        {checked && <Check size={12} strokeWidth={3} className="text-accent" />}
      </span>
    </span>
  );
}

/** A switch whose whole row — title and description included — is the control. */
export function Toggle({ checked, onChange, label, description, disabled, className = "" }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <button type="button" role="switch" aria-checked={checked} aria-describedby={description ? id : undefined} disabled={disabled} onClick={() => onChange(!checked)}
      className={`-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-control px-2 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-50 ${className}`}>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {description && <span id={id} className="mt-0.5 block text-small text-muted">{description}</span>}
      </span>
      <span className="pt-0.5"><Track checked={checked} /></span>
    </button>
  );
}

export function Pill({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={`chip ${TONE_SOFT[tone]} ${className}`}>{children}</span>;
}

export function IconTile({ children, tone = "accent", size = "md" }: { children: ReactNode; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-8 w-8 rounded-[8px]", md: "h-10 w-10 rounded-[11px]", lg: "h-14 w-14 rounded-[16px]" }[size];
  return <span className={`grid shrink-0 place-items-center ${dims} ${TONE_SOFT[tone]}`}>{children}</span>;
}

/** Key/value list. Side by side when there is room, stacked on narrow screens; values wrap
 *  instead of being cut off, so long IDs and addresses stay readable. */
export function DataList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`@container m-0 ${className}`}>{children}</dl>;
}

export function Row({ label, children, data, action }: { label: string; children: ReactNode; data?: boolean; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 @sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] @sm:items-baseline">
      <dt className="text-small text-muted @sm:text-body">{label}</dt>
      <dd className={`selectable flex min-w-0 items-center gap-1.5 font-medium @sm:justify-end @sm:text-right ${data ? "data" : "break-words"}`}>
        <span className="min-w-0">{children}</span>{action}
      </dd>
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <IconButton label={label ?? t("copy")} className="-my-2 -mr-1.5" onClick={() => void copyText(value).then((ok) => ok && toast("ok", t("copied")))}>
      <Copy size={14} aria-hidden />
    </IconButton>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  const Tag = htmlFor ? "div" : "label";
  return (
    <Tag className="block min-w-0">
      {htmlFor ? <label htmlFor={htmlFor} className="mb-1.5 block text-small font-semibold">{label}</label> : <span className="mb-1.5 block text-small font-semibold">{label}</span>}
      {children}
      {error ? <span role="alert" className="mt-1.5 flex items-start gap-1.5 text-small text-err"><XCircle size={14} className="mt-[3px] shrink-0" aria-hidden />{error}</span>
        : hint ? <span className="mt-1.5 block text-small text-muted">{hint}</span> : null}
    </Tag>
  );
}

/** Determinate when `value` is a number (0–1), animated stripe otherwise. */
export function Progress({ value, label, tone = "accent" }: { value: number | null; label?: string; tone?: "accent" | "ok" }) {
  const fill = tone === "ok" ? "bg-ok" : "brand-gradient";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      {value == null
        ? <div className={`indeterminate h-full w-2/5 rounded-full ${fill}`} />
        : <div className={`h-full rounded-full transition-[width] duration-300 ${fill}`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />}
    </div>
  );
}

const NOTICE: Record<"info" | "warn" | "err" | "ok", { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "bg-accent-soft border-accent-line", icon: "text-accent-text", Icon: Info },
  warn: { box: "bg-warn-soft border-[color-mix(in_srgb,var(--warn)_28%,transparent)]", icon: "text-warn", Icon: AlertTriangle },
  err: { box: "bg-err-soft border-[color-mix(in_srgb,var(--err)_28%,transparent)]", icon: "text-err", Icon: XCircle },
  ok: { box: "bg-ok-soft border-[color-mix(in_srgb,var(--ok)_28%,transparent)]", icon: "text-ok", Icon: CheckCircle2 },
};

/** Inline message. Title says what happened; the body explains why and what to do next. */
export function Notice({ tone, title, children, action, live = true }: { tone: "info" | "warn" | "err" | "ok"; title?: string; children?: ReactNode; action?: ReactNode; live?: boolean }) {
  const { box, icon, Icon } = NOTICE[tone];
  return (
    <div role={live ? (tone === "err" ? "alert" : "status") : undefined} className={`fade-up flex gap-3 rounded-[12px] border p-3.5 ${box}`}>
      <Icon size={18} className={`mt-px shrink-0 ${icon}`} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div className={`text-small leading-relaxed ${title ? "mt-0.5 text-muted" : "text-fg"}`}>{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function Details({ label, children, onOpen, prose }: { label: string; children: ReactNode; onOpen?: () => void; prose?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-2">
      <button type="button" onClick={() => { if (!open) onOpen?.(); setOpen(!open); }} aria-expanded={open} aria-controls={id}
        className="-ml-1 inline-flex min-h-8 items-center gap-1 rounded-[8px] px-1 text-small font-medium text-muted hover:text-fg">
        <ChevronDown size={15} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
        {label}
      </button>
      {open && (prose
        ? <div id={id} className="selectable fade-in mt-1.5 max-h-60 overflow-auto rounded-[10px] border border-line bg-surface-2 p-3 text-small leading-relaxed whitespace-pre-line text-fg">{children}</div>
        : <pre id={id} className="selectable data fade-in mt-1.5 max-h-52 overflow-auto rounded-[10px] border border-line bg-surface-2 p-3 font-mono text-caption leading-relaxed whitespace-pre-wrap text-fg">{children}</pre>)}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="fade-up grid place-items-center rounded-card border border-dashed border-line-strong px-6 py-12 text-center">
      <IconTile size="lg">{icon}</IconTile>
      <p className="mt-4 text-emph font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-muted">{body}</p>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 sm:mb-7">
      <div className="min-w-0 flex-[1_1_16rem]">
        <h1 className="text-heading font-semibold tracking-[-0.015em]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[60ch] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </header>
  );
}

/** Settings-style group: small heading above a card of rows. */
export function Section({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="fade-up" aria-label={title}>
      <h2 className="eyebrow mb-2 px-1">{title}</h2>
      <div className="card p-4 sm:p-5">
        {description && <p className="mb-3 text-small text-muted">{description}</p>}
        {children}
      </div>
    </section>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Dialog: centred on wide screens, bottom sheet on phones. Traps focus and gives it back. */
export function Modal({ title, onClose, children, footer, wide, dismissible = true }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; dismissible?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[autofocus], input, select, textarea");
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) { e.stopPropagation(); close.current(); }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [dismissible]);
  return createPortal(
    <div className="fade-in fixed inset-0 z-40 flex items-end justify-center bg-[var(--scrim)] sm:items-center sm:p-6" onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`sheet-in flex max-h-[min(92dvh,52rem)] w-full flex-col rounded-t-dialog border border-line bg-surface shadow-pop outline-none sm:rounded-dialog ${wide ? "sm:max-w-[36rem]" : "sm:max-w-[28rem]"}`}>
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex items-start gap-3 px-5 pt-3 pb-2 sm:pt-5">
          <h2 id={titleId} className="min-w-0 flex-1 pt-1 text-title font-semibold tracking-[-0.01em]">{title}</h2>
          {dismissible && <IconButton label={t("close")} onClick={onClose} className="-mr-2"><X size={18} aria-hidden /></IconButton>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-5">{children}</div>
        {footer && <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end [&>.btn]:w-full sm:[&>.btn]:w-auto">{footer}</div>}
        {!footer && <div className="safe-bottom" />}
      </div>
    </div>,
    document.body,
  );
}

// ---------- toasts ----------

interface Toast { id: number; tone: "ok" | "err" | "info"; text: string }
const ToastContext = createContext<(tone: Toast["tone"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "err" ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="pop-in pointer-events-auto flex max-w-md items-start gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3 shadow-pop">
            {t.tone === "ok" ? <CheckCircle2 size={18} className="mt-px shrink-0 text-ok" aria-hidden /> : t.tone === "err" ? <AlertTriangle size={18} className="mt-px shrink-0 text-err" aria-hidden /> : <Info size={18} className="mt-px shrink-0 text-accent-text" aria-hidden />}
            <span className="min-w-0 font-medium">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Copies text; falls back for webviews without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export { TONE_TEXT };
