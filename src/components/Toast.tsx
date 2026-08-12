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
    const fadeTimer = window.setTimeout(() => setFading(true), 2000);
    const closeTimer = window.setTimeout(() => onCloseRef.current?.(), 3000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(closeTimer);
    };
  }, [toast?.id]);

  if (!toast) return null;

  return (
    <div className={`toast toast-${toast.type}${fading ? " is-fading" : ""}`}>
      <span className="toast-message">{toast.message}</span>
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
      {onClose && (
        <button className="btn-close" onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
};
