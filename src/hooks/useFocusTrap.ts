import { useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "details > summary",
  "embed",
  "iframe",
  "input:not([disabled]):not([type='hidden'])",
  "object",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function isFocusable(element: HTMLElement): boolean {
  return !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && !element.closest("[hidden], [aria-hidden='true']")
    && !element.hasAttribute("inert")
    && !element.closest("[inert]");
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isFocusable);
}

/** Provides the shared keyboard contract for modal and drawer surfaces. */
export function useFocusTrap<T extends HTMLElement>(open: boolean, onClose?: () => void): RefObject<T | null> {
  const rootRef = useRef<T | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    if (!root) return;
    const focusFirst = () => {
      const initial = root.querySelector<HTMLElement>("[data-focus-trap-initial]");
      const first = initial && isFocusable(initial) ? initial : getFocusableElements(root)[0];
      (first ?? root).focus({ preventScroll: true });
    };
    focusFirst();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = getFocusableElements(root);
      if (!elements.length) { event.preventDefault(); root.focus(); return; }
      const activeIndex = elements.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? elements.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === elements.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      elements[nextIndex].focus({ preventScroll: true });
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (root.contains(event.target as Node)) return;
      const active = document.activeElement;
      if (active && root.contains(active)) return;
      const first = getFocusableElements(root)[0];
      if (first) first.focus({ preventScroll: true });
      else root.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("focusin", keepFocusInside, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("focusin", keepFocusInside, true);
      const opener = openerRef.current;
      if (opener?.isConnected && !opener.hasAttribute("disabled")) opener.focus({ preventScroll: true });
      openerRef.current = null;
    };
  }, [open]);
  return rootRef;
}
