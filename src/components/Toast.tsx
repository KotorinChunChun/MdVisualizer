import React, { useEffect, useRef, useState } from "react";
import { ToastState } from "../types/app";

interface ToastProps {
  toast: ToastState | null;
  onRestore?: (path: string) => void;
  onClose?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onRestore, onClose }) => {
  const [fading, setFading] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!toast) return;
    setFading(false);
    const actionable = Boolean(toast.actionLabel || toast.actions?.length || toast.restorePath || toast.onMessageClick);
    const fadeTimer = window.setTimeout(() => setFading(true), actionable ? 7000 : 3000);
    const closeTimer = window.setTimeout(() => onCloseRef.current?.(), actionable ? 8000 : 4000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(closeTimer);
    };
  }, [toast?.id]);

  if (!toast) return null;

  return (
    <div className={`toast toast-${toast.type}${fading ? " is-fading" : ""}`}>
      <span
        className="toast-message"
        role={toast.onMessageClick ? "button" : undefined}
        tabIndex={toast.onMessageClick ? 0 : undefined}
        title={toast.onMessageClick ? "クリックして保存フォルダーを開く" : undefined}
        onClick={toast.onMessageClick ? () => void toast.onMessageClick?.() : undefined}
        onKeyDown={toast.onMessageClick ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void toast.onMessageClick?.();
          }
        } : undefined}
      >{toast.message}</span>
      {toast.restorePath && onRestore && (
        <button
          className="btn btn-restore"
          onClick={() => onRestore(toast.restorePath!)}
        >
          ↩ 元に戻す
        </button>
      )}
      {toast.actionLabel && toast.onAction && (
        <button className="btn btn-toast-action" onClick={() => void toast.onAction?.()}>
          {toast.actionLabel}
        </button>
      )}
      {toast.actions?.map((action) => <button
        key={action.label}
        className="btn btn-toast-action"
        onClick={() => void action.onAction()}
      >{action.label}</button>)}
      {onClose && (
        <button className="btn-close" onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
};
