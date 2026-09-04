import { useEffect, useId, useRef, useState } from 'react';

// Searchable select for long option lists — a text input that filters a
// dropdown. Calls onChange({ target: { value } }) like a native <select>.
export default function SearchSelect({ options, value, onChange, placeholder, inputId, allowClear }) {
  const [open, setOpen]           = useState(false);
  const [query, setQuery]         = useState(null); // null = not editing, show selected label
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef(null);
  const reactId = useId();
  const listId = `${inputId || reactId}-listbox`;

  const selected = options.find(o => o.value === value);
  const selectedLabel = selected ? selected.label : '';
  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  function openList() {
    setOpen(true);
    setHighlight(Math.max(0, options.findIndex(o => o.value === value)));
  }

  function close() {
    setOpen(false);
    setQuery(null); // revert free text to the selected label
  }

  function select(opt) {
    onChange({ target: { value: opt.value } });
    setOpen(false);
    setQuery(null);
  }

  // Leaving the field (blur) commits an unambiguous typed match instead of
  // silently reverting it — typing "Cali" then clicking the next field should
  // select California, not quietly keep the old value.
  function handleBlur() {
    if (query) {
      const exact = options.find(o => o.label.toLowerCase() === query.toLowerCase());
      if (exact) return select(exact);
      if (filtered.length === 1) return select(filtered[0]);
    }
    close();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return openList();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      // Empty text = no selection intent — never auto-pick the first option.
      if (query === '') return close();
      const exact = query && options.find(o => o.label.toLowerCase() === query.toLowerCase());
      if (exact) return select(exact);
      if (filtered[highlight]) select(filtered[highlight]);
      else close();
    } else if (e.key === 'Escape') {
      close();
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={inputId}
        className="form-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[highlight] ? `${listId}-opt-${highlight}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query !== null ? query : selectedLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onClick={() => { if (!open) openList(); }}
        onFocus={() => { if (!open) openList(); }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{ minHeight: 44, paddingRight: allowClear && value ? 76 : 36, boxSizing: 'border-box' }}
      />
      {allowClear && value && (
        <button
          type="button"
          aria-label="Clear selection"
          onMouseDown={(e) => { e.preventDefault(); onChange({ target: { value: '' } }); setQuery(null); }}
          style={{
            position: 'absolute', right: 30, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.8667rem', fontWeight: 600, color: 'var(--text-secondary)',
            minHeight: 32, padding: '0 8px',
          }}
        >
          ✕
        </button>
      )}
      <span aria-hidden="true" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.6667rem', pointerEvents: 'none' }}>▼</span>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          onMouseDown={(e) => {
            // Keep the input focused for clicks in the option area, but let
            // mousedowns on the scrollbar strip through — preventDefault there
            // blocks scrollbar dragging in Firefox.
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX < r.right - 18) e.preventDefault();
          }}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: '100%', width: 'max-content', maxWidth: 360, zIndex: 30,
            margin: '4px 0 0', padding: 4, listStyle: 'none',
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
            maxHeight: 320, overflowY: 'auto',
          }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: '10px 14px', fontSize: '1rem', color: 'var(--text-muted)' }}>No matches</li>
          )}
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={opt.value === value}
              onMouseDown={(e) => { e.preventDefault(); select(opt); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '10px 14px', minHeight: 40, boxSizing: 'border-box',
                display: 'flex', alignItems: 'center', cursor: 'pointer',
                fontSize: '1rem', color: 'var(--text-primary)', borderRadius: 6,
                background: i === highlight ? 'var(--accent-light)' : 'transparent',
                fontWeight: opt.value === value ? 700 : 400,
              }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
