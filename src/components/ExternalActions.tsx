import { useEffect, useRef, useState } from "react";
import type { ExternalAppConfig } from "../types/settings";

export function ExternalActions({
  apps,
  disabled,
  onExecute,
  title = "外部で開く",
  compact = false,
}: {
  apps: ExternalAppConfig[];
  disabled?: boolean;
  onExecute: (app: ExternalAppConfig) => void;
  title?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = apps.filter((app) => app.enabled).sort((left, right) => left.order - right.order);
  const primary = active.filter((app) => app.placement === "primary");
  const menu = active.filter((app) => app.placement === "menu");

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside, true);
    window.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside, true);
      window.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  const execute = (app: ExternalAppConfig) => {
    setOpen(false);
    onExecute(app);
  };
  return <div className={`${compact ? "" : "control-group " }external-actions`} ref={rootRef}>
    {title && <span className="control-group__title">{title}</span>}
    {primary.map((app) => <button type="button" key={app.id} disabled={disabled} onClick={() => execute(app)}>{app.label}</button>)}
    {menu.length > 0 && <div className="external-more">
      <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((value) => !value)}>その他 ▾</button>
      {open && <div className="external-more__menu" role="menu">
        {menu.map((app) => <button type="button" role="menuitem" key={app.id} onClick={() => execute(app)}>{app.label}</button>)}
      </div>}
    </div>}
  </div>;
}
