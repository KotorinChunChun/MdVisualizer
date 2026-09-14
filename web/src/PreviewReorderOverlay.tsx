import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { collectPreviewMoveUnits, movePreviewUnit } from './previewReorder';
import './previewReorder.css';

type Unit = ReturnType<typeof collectPreviewMoveUnits>[number];
type Overlay = { label: string; top: number; left: number; width: number; targetLabel: string };
type Props = { root: RefObject<HTMLElement | null>; markdown: string; enabled: boolean; onChange: (expected: string, next: string) => boolean; notify: (message: string) => void };

/** Touch listeners remain passive until a stationary long press has selected a source unit. */
export function PreviewReorder({ root, markdown, enabled, onChange, notify }: Props) {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const actions = useRef<{ cancel: () => void; step: (direction: number) => void } | null>(null);
  const current = useRef({ markdown, onChange, notify });
  current.current = { markdown, onChange, notify };

  useEffect(() => {
    const host = root.current;
    if (!host || !enabled) return;
    const units = collectPreviewMoveUnits(markdown);
    type Selection = { unit: Unit; element: HTMLElement; x: number; y: number; touchId: number | null };
    let pending: Selection | null = null;
    let selected: Selection | null = null;
    let destination: { unit: Unit; placement: 'before' | 'after' } | null = null;
    let timer = 0;
    let frame = 0;
    let lastY = 0;
    let suppressUntil = 0;

    const rendered = (unit: Unit) => [...host.querySelectorAll<HTMLElement>(`[data-source-line="${unit.startLine}"]`)]
      .filter(element => element.getBoundingClientRect().height > 0)
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    const reset = () => {
      window.clearTimeout(timer); cancelAnimationFrame(frame);
      selected?.element.classList.remove('web-reorder-picked');
      host.classList.remove('web-reorder-active');
      pending = null; selected = null; destination = null; setOverlay(null);
    };
    const commit = (target: Unit, placement: 'before' | 'after') => {
      if (!selected) return;
      const source = selected.unit;
      reset();
      if (current.current.markdown !== markdown) { current.current.notify('文書が変更されたため移動を取り消しました。'); return; }
      try {
        const next = movePreviewUnit(markdown, source.id, target.id, placement);
        if (next !== markdown && current.current.onChange(markdown, next)) {
          setUndo({ before: markdown, after: next });
          current.current.notify('行を移動しました。元に戻すことができます。');
        }
      } catch (error) { current.current.notify(error instanceof Error ? error.message : String(error)); }
    };
    const update = (y: number) => {
      if (!selected) return;
      lastY = y;
      const candidates = units.filter(unit => unit.group === selected!.unit.group && unit.id !== selected!.unit.id)
        .map(unit => ({ unit, element: rendered(unit) })).filter(item => item.element)
        .map(item => ({ ...item, rect: item.element!.getBoundingClientRect() }));
      const candidate = candidates.sort((a, b) => {
        const distance = (r: DOMRect) => y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        return distance(a.rect) - distance(b.rect);
      })[0];
      if (!candidate) return;
      const placement = y < (candidate.rect.top + candidate.rect.bottom) / 2 ? 'before' : 'after';
      destination = { unit: candidate.unit, placement };
      setOverlay({ label: selected.unit.label, targetLabel: `${candidate.unit.label}の${placement === 'before' ? '前' : '後'}`,
        top: Math.max(3, Math.min(innerHeight - 4, placement === 'before' ? candidate.rect.top : candidate.rect.bottom)),
        left: Math.max(4, candidate.rect.left), width: Math.min(candidate.rect.width, innerWidth - 8) });
    };
    const autoScroll = () => {
      if (!selected) return;
      let scroll: HTMLElement | null = selected.element.parentElement;
      while (scroll && scroll !== document.body && !(scroll.scrollHeight > scroll.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement;
      const scroller = scroll && scroll !== document.body ? scroll : document.scrollingElement as HTMLElement;
      if (scroller) {
        const rect = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
        const delta = lastY < rect.top + 48 ? -10 : lastY > rect.bottom - 48 ? 10 : 0;
        if (delta) { scroller.scrollTop += delta; update(lastY); }
      }
      frame = requestAnimationFrame(autoScroll);
    };
    const begin = (target: EventTarget | null, x: number, y: number, touchId: number | null) => {
      reset();
      const element = target instanceof Element ? target : null;
      if (!element || element.closest('button,a,input,textarea,select,summary,[contenteditable="true"],.web-preview-toc,.preview-inline-edit')) return;
      const anchor = element.closest<HTMLElement>('[data-source-line]');
      if (!anchor || !host.contains(anchor)) return;
      const line = Number(anchor.dataset.sourceLine);
      const unit = units.filter(item => item.startLine <= line && item.endLine >= line)
        .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
      if (!unit || units.filter(item => item.group === unit.group).length < 2) return;
      pending = { unit, element: rendered(unit) ?? anchor, x, y, touchId };
      timer = window.setTimeout(() => {
        if (!pending || current.current.markdown !== markdown) return;
        selected = pending;
        selected.element.classList.add('web-reorder-picked'); host.classList.add('web-reorder-active');
        window.getSelection()?.removeAllRanges(); lastY = y; update(y);
        frame = requestAnimationFrame(autoScroll);
      }, 500);
    };
    const move = (x: number, y: number, event: Event) => {
      if (selected) { if (event.cancelable) event.preventDefault(); update(y); }
      else if (pending && Math.hypot(x - pending.x, y - pending.y) > 10) reset();
    };
    const finish = () => {
      window.clearTimeout(timer);
      if (selected) {
        suppressUntil = Date.now() + 500;
        // A stationary long press selects only; it must never reorder without a swipe.
        if (destination && Math.abs(lastY - selected.y) > 10) { commit(destination.unit, destination.placement); return; }
        pending = null; cancelAnimationFrame(frame); return;
      }
      reset();
    };
    const touchStart = (event: TouchEvent) => { if (event.touches.length !== 1) { reset(); return; } const t = event.touches[0]; begin(event.target, t.clientX, t.clientY, t.identifier); };
    const touchMove = (event: TouchEvent) => { if (event.touches.length !== 1) { reset(); return; } const t = [...event.touches].find(touch => touch.identifier === (selected ?? pending)?.touchId); if (t) move(t.clientX, t.clientY, event); };
    const pointerDown = (event: PointerEvent) => { if (event.pointerType === 'touch' || event.button !== 0) return; begin(event.target, event.clientX, event.clientY, null); };
    const pointerMove = (event: PointerEvent) => { if (event.pointerType !== 'touch') move(event.clientX, event.clientY, event); };
    const pointerUp = (event: PointerEvent) => { if (event.pointerType !== 'touch') finish(); };
    const context = (event: Event) => { if (selected || pending) event.preventDefault(); };
    const click = (event: Event) => { if (selected || Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); } };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && event.target instanceof HTMLElement && host.contains(event.target)) {
        const rect = event.target.getBoundingClientRect();
        begin(event.target, rect.left + 5, rect.top + rect.height / 2, null);
        window.clearTimeout(timer);
        if (pending) { event.preventDefault(); selected = pending; actions.current?.step(event.key === 'ArrowUp' ? -1 : 1); }
      }
    };
    actions.current = { cancel: reset, step: direction => {
      if (!selected) return;
      const group = units.filter(unit => unit.group === selected!.unit.group);
      const target = group[group.findIndex(unit => unit.id === selected!.unit.id) + direction];
      if (target) commit(target, direction < 0 ? 'before' : 'after');
    } };
    const keyboardTargets = new Map<HTMLElement, string | null>();
    for (const unit of units) {
      const element = rendered(unit);
      if (!element || keyboardTargets.has(element) || element.matches('a,button,input,select,textarea')) continue;
      keyboardTargets.set(element, element.getAttribute('tabindex'));
      element.tabIndex = 0;
      element.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    }
    host.classList.add('web-reorder-enabled');
    host.addEventListener('touchstart', touchStart, { passive: true });
    host.addEventListener('touchmove', touchMove, { passive: false });
    host.addEventListener('touchend', finish); host.addEventListener('touchcancel', reset);
    host.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', pointerUp);
    host.addEventListener('contextmenu', context); host.addEventListener('click', click, true);
    window.addEventListener('keydown', key); window.addEventListener('blur', reset);
    return () => {
      reset(); actions.current = null; host.classList.remove('web-reorder-enabled');
      keyboardTargets.forEach((tabindex, element) => { if (tabindex === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', tabindex); element.removeAttribute('aria-keyshortcuts'); });
      host.removeEventListener('touchstart', touchStart); host.removeEventListener('touchmove', touchMove);
      host.removeEventListener('touchend', finish); host.removeEventListener('touchcancel', reset);
      host.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp);
      host.removeEventListener('contextmenu', context); host.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key); window.removeEventListener('blur', reset);
    };
  }, [root, markdown, enabled]);

  return createPortal(<>
    {overlay && <>
      <div className="web-reorder-insertion" aria-hidden="true" style={{ top: overlay.top, left: overlay.left, width: overlay.width }} />
      <div className="web-reorder-panel" role="region" aria-label="行の移動">
        <span role="status">{overlay.label} → {overlay.targetLabel}</span>
        <div><button type="button" onClick={() => actions.current?.step(-1)}>上へ移動</button><button type="button" onClick={() => actions.current?.step(1)}>下へ移動</button><button type="button" onClick={() => actions.current?.cancel()}>移動を取消</button></div>
      </div>
    </>}
    {!overlay && undo && markdown === undo.after && <div className="web-reorder-panel web-reorder-undo"><button type="button" onClick={() => { if (onChange(undo.after, undo.before)) setUndo(null); }}>行移動を元に戻す</button></div>}
  </>, document.body);
}
