import React from "react";
import { ToastState } from "../types/app";

interface ToastProps {
  toast: ToastState | null;
  onRestore?: (path: string) => void;
  onClose?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onRestore, onClose }) => {
  if (!toast) return null;

  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-message">{toast.message}</span>
      {toast.restorePath && onRestore && (
        <button
          className="btn btn-restore"
          onClick={() => onRestore(toast.restorePath!)}
        >
          ↩ 元に戻す
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
