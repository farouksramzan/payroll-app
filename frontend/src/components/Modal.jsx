import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({ title, onClose, children, footer }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      // Simple focus containment — Tab cycles inside the dialog.
      const focusables = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE))
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = dialogRef.current.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) { e.preventDefault(); last.focus(); }
      } else {
        if (!inside || active === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Initial focus: first form control or non-close button, else the dialog itself.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const target = node.querySelector('input, select, textarea, button:not(.modal-close)');
    (target || node).focus();
  }, []);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
