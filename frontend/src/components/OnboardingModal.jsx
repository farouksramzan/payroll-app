import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const STORAGE_KEY = 'payrolltaxpro_tour_v5';
const TOTAL_STEPS = 7;

// ── Cancellable DOM poller — stops if generation token changes ────────────────
function waitAndAct(tourId, { click = false, scroll = false } = {}, tokenRef, myToken, delayMs = 200) {
  const start = Date.now();
  const attempt = () => {
    if (tokenRef.current !== myToken) return; // step changed — abort
    const el = document.querySelector(`[data-tour-id="${tourId}"]`);
    if (el) {
      if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (click) el.click();
      return;
    }
    if (Date.now() - start < 5000) setTimeout(attempt, 200);
  };
  setTimeout(attempt, delayMs);
}

// ── Pulsing spotlight overlay ─────────────────────────────────────────────────
function TourSpotlight({ targetId, padding = 10 }) {
  const [rect, setRect] = useState(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!targetId) { setRect(null); return; }
    let active = true;

    const track = () => {
      if (!active) return;
      const el = document.querySelector(`[data-tour-id="${targetId}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top - padding, left: r.left - padding, width: r.width + padding * 2, height: r.height + padding * 2 });
      } else {
        setRect(null);
      }
      rafRef.current = requestAnimationFrame(track);
    };
    rafRef.current = requestAnimationFrame(track);
    return () => { active = false; cancelAnimationFrame(rafRef.current); };
  }, [targetId, padding]);

  if (!rect) return null;

  return (
    <>
      {/* Dark surround via box-shadow spreading outward from spotlight area.
          zIndex MUST be below ModalOverlay (1000) so modals render above it. */}
      <div
        style={{
          position: 'fixed',
          zIndex: 500,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          borderRadius: 10,
          pointerEvents: 'none',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.52)',
          border: '2px solid #4ade80',
          animation: 'tour-pulse 1.8s ease-in-out infinite',
        }}
      />
      {/* Animated arrow label */}
      <div style={{
        position: 'fixed',
        zIndex: 501,
        top: rect.top - 38,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
        background: '#4ade80',
        color: '#052e16',
        fontSize: 11,
        fontWeight: 800,
        padding: '4px 12px',
        borderRadius: 20,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        ↓ Look here
      </div>
    </>
  );
}

// ── Step config factory ───────────────────────────────────────────────────────
function buildSteps(habibiId) {
  const base = `/clients/${habibiId}`;
  return [
    null, // 0 = welcome (inline)
    {
      // Step 1 — Dashboard
      title: '🏢 Your Client Dashboard',
      body: 'All your payroll clients are listed here. Each card shows the company name, upcoming payroll date, and deposit schedule.',
      hint: 'Find and click the Habibi Hookah Cafe card to open its workspace.',
      spotlight: null, // user needs to scroll/look themselves
      doNav: true, to: '/', toState: null,
      autoClick: null,
    },
    {
      // Step 2 — Payroll tab
      title: '📋 Payroll Tab — Pay Periods',
      body: "You're inside Habibi Hookah Cafe's workspace. The Payroll tab shows every pay period — pending upcoming ones at the top and completed checks below.",
      hint: 'The Payroll tab is being highlighted — it should already be active.',
      spotlight: 'tour-payroll-tab-btn',
      doNav: true, to: base, toState: { tab: 'payroll' },
      autoClick: 'tour-payroll-tab-btn',
    },
    {
      // Step 3 — Printed checks (auto-expand & scroll)
      title: '✅ Deposited Checks',
      body: 'Below the pending section are your printed/deposited checks — completed pay periods. Each row shows gross wages, net pay, taxes withheld, and check number.',
      hint: 'The "Printed & Deposited Checks" section is expanding automatically — scroll down if needed.',
      spotlight: 'tour-printed-section',
      doNav: false, to: null, toState: null,
      autoClick: 'tour-printed-toggle', // expands the section
    },
    {
      // Step 4 — Tax breakdown (auto-open modal)
      title: '🧾 Live Tax Breakdown',
      body: 'Opening a check now so you can see the full IRS 2026 tax calculation: Federal Income Tax (Pub 15-T percentage method), Social Security (6.2%), Medicare (1.45%), employer match, FUTA (0.6%), and state SUI — all computed live. YTD columns accumulate across the year.',
      hint: 'The check detail modal should be opening automatically.',
      spotlight: null, // modal opens, nothing to spotlight on page
      doNav: false, to: null, toState: null,
      autoClick: 'tour-first-check',
    },
    {
      // Step 5 — Pending checks
      title: '⏳ Pending Pay Periods',
      body: 'At the top of the Payroll tab are pending pay periods — the next upcoming payroll. Enter hours and rates inline; net pay and all taxes update in real time. Click "Run Payroll" when ready to deposit.',
      hint: 'The pending section is highlighted at the top of the Payroll tab.',
      spotlight: 'tour-pending-section',
      doNav: false, to: null, toState: null,
      autoClick: null,
    },
    {
      // Step 6 — Pay Liabilities (auto-click sub-tab)
      title: '🏦 Pay Liabilities',
      body: 'Switching to the Liabilities sub-tab now. It tracks your 941 deposit obligations (Federal Income Tax + FICA) and 940 deposits (FUTA) — with IRS due dates, semiweekly vs. monthly deposit schedules, and amounts owed per period.',
      hint: 'The Pay Liabilities sub-tab is being activated automatically.',
      spotlight: 'tour-liabilities-tab',
      doNav: false, to: null, toState: null,
      autoClick: 'tour-liabilities-tab',
    },
    {
      // Step 7 — Employees tab
      title: '👥 Employees Tab',
      body: 'Switching to the Employees tab. Each employee profile shows full W-4 settings (Steps 1–4), pay type (hourly or salary), pay group assignment, and bank account for ACH direct deposit. Click any employee to view or edit their profile.',
      hint: 'The Employees tab is being activated — see all team members listed.',
      spotlight: 'tour-employees-tab-btn',
      doNav: true, to: base, toState: { tab: 'employees' },
      autoClick: 'tour-employees-tab-btn',
    },
  ];
}

// ── Progress dots ─────────────────────────────────────────────────────────────
function StepDots({ current, total, onGoto }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        return (
          <div
            key={n}
            onClick={() => onGoto(n)}
            style={{
              width: n === current ? 20 : 7, height: 7, borderRadius: 4,
              background: n === current ? '#22c55e' : n < current ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.2)',
              transition: 'all 0.2s', cursor: 'pointer', flexShrink: 0,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OnboardingModal() {
  const navigate = useNavigate();

  const [step, setStep] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'dismissed' ? null : 0; } catch { return 0; }
  });
  const [habibiId, setHabibiId] = useState(null);
  const [spotlight, setSpotlight] = useState(null);

  // Generation counter — incremented on every step change to cancel stale auto-clicks
  const genRef = useRef(0);

  // Fetch Habibi client ID once tour starts
  useEffect(() => {
    if (step === null || step === 0 || habibiId) return;
    api.getClients()
      .then(clients => {
        const h = clients.find(c =>
          (c.businessName || c.business_name || '').toLowerCase().includes('habibi')
        );
        if (h) setHabibiId(h.id);
      })
      .catch(() => {});
  }, [step, habibiId]);

  // On step change: navigate if needed, run autoClick, set spotlight
  useEffect(() => {
    if (step === null || step === 0 || step === 8 || !habibiId) return;
    const steps = buildSteps(habibiId);
    const s = steps[step];
    if (!s) return;

    // Invalidate any pending waitAndAct from the previous step
    genRef.current += 1;
    const myToken = genRef.current;

    // Navigate
    if (s.doNav && s.to) {
      navigate(s.to, { state: s.toState, replace: false });
    }

    // Clear spotlight immediately so a stale spotlight never covers a modal
    setSpotlight(null);

    // Auto-click or scroll after render settles (longer delay for step 4 so
    // the modal opens cleanly without any spotlight active)
    const actionDelay = step === 4 ? 500 : 220;

    if (s.autoClick) {
      waitAndAct(s.autoClick, { click: true, scroll: true }, genRef, myToken, actionDelay);
    }

    // Set spotlight slightly after action so it never races with a modal
    if (s.spotlight) {
      setTimeout(() => {
        if (genRef.current === myToken) setSpotlight(s.spotlight);
      }, s.autoClick ? actionDelay + 300 : 300);
    }
  }, [step, habibiId]); // eslint-disable-line

  const dismiss = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, 'dismissed'); } catch {}
    setStep(null);
    setSpotlight(null);
  }, []);

  const goNext = useCallback(() => {
    setStep(s => s >= TOTAL_STEPS ? 8 : s + 1);
  }, []);

  const goPrev = useCallback(() => {
    setStep(s => s <= 1 ? 1 : s - 1);
  }, []);

  if (step === null) return null;

  // ── Welcome ───────────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <>
        <style>{`
          @keyframes tour-pulse {
            0%   { box-shadow: 0 0 0 9999px rgba(0,0,0,0.52), 0 0 0 4px rgba(74,222,128,0.6); }
            50%  { box-shadow: 0 0 0 9999px rgba(0,0,0,0.52), 0 0 0 8px rgba(74,222,128,0.2); }
            100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.52), 0 0 0 4px rgba(74,222,128,0.6); }
          }
        `}</style>
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#0f172a', borderRadius: 20, width: '100%', maxWidth: 520, boxShadow: '0 30px 80px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <div style={{ height: 4, background: 'linear-gradient(90deg, #16a34a, #4ade80)' }} />
            <div style={{ padding: '32px 36px 28px' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
                <button onClick={dismiss} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '4px 12px', cursor: 'pointer' }}>
                  Skip tour ×
                </button>
              </div>
              <div style={{ fontSize: 40, marginBottom: 14 }}>👋</div>
              <h2 style={{ fontSize: 24, fontWeight: 900, color: '#f1f5f9', margin: '0 0 10px', letterSpacing: '-0.3px' }}>Welcome to PayrollTax Pro</h2>
              <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.75, margin: '0 0 24px' }}>
                We'll walk you through <strong style={{ color: '#4ade80' }}>Habibi Hookah Cafe</strong> — a real client in this account. The tour auto-navigates and auto-opens everything so you can just watch.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
                {[
                  { icon: '✅', text: 'Deposited checks auto-expanded and highlighted' },
                  { icon: '🧾', text: 'Tax breakdown modal auto-opened — FIT, SS, Medicare, FUTA' },
                  { icon: '🏦', text: 'Pay Liabilities tab auto-switched — 941 and 940 schedules' },
                  { icon: '👥', text: 'Employees tab — W-4 settings and direct deposit info' },
                ].map(item => (
                  <div key={item.text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                    <span style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={dismiss} style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Skip for now
                </button>
                <button onClick={() => setStep(1)} style={{ flex: 2, padding: '11px 0', borderRadius: 10, background: 'linear-gradient(135deg, #16a34a, #15803d)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(22,163,74,0.35)' }}>
                  Start Tour →
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (step === 8) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#0f172a', borderRadius: 20, width: '100%', maxWidth: 460, boxShadow: '0 30px 80px rgba(0,0,0,0.5)', border: '1px solid rgba(34,197,94,0.25)', overflow: 'hidden', textAlign: 'center' }}>
          <div style={{ height: 4, background: 'linear-gradient(90deg, #16a34a, #4ade80)' }} />
          <div style={{ padding: '40px 36px 36px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: '0 0 12px' }}>You've seen it all!</h2>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.75, margin: '0 0 10px' }}>
              That's the full PayrollTax Pro workflow — real IRS 2026 tax tables, EFTPS submission, ACH direct deposit, and <strong style={{ color: '#4ade80' }}>zero per-check fees</strong>.
            </p>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, margin: '0 0 28px' }}>Every number in this app uses real IRS logic — nothing is mocked.</p>
            <button onClick={dismiss} style={{ width: '100%', padding: '12px 0', borderRadius: 10, background: 'linear-gradient(135deg, #16a34a, #15803d)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(22,163,74,0.3)' }}>
              Start Exploring →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Guide steps 1–7 ───────────────────────────────────────────────────────
  const steps = habibiId ? buildSteps(habibiId) : null;
  const current = steps?.[step];

  return (
    <>
      <style>{`
        @keyframes tour-pulse {
          0%   { box-shadow: 0 0 0 9999px rgba(0,0,0,0.52), 0 0 0 4px rgba(74,222,128,0.6); }
          50%  { box-shadow: 0 0 0 9999px rgba(0,0,0,0.52), 0 0 0 10px rgba(74,222,128,0.15); }
          100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.52), 0 0 0 4px rgba(74,222,128,0.6); }
        }
      `}</style>

      {/* Spotlight */}
      {spotlight && <TourSpotlight targetId={spotlight} />}

      {/* Floating guide card — bottom center */}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9700, width: '100%', maxWidth: 560, padding: '0 16px', pointerEvents: 'none',
      }}>
        <div style={{
          background: '#0f172a', borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)',
          overflow: 'hidden', pointerEvents: 'all',
        }}>
          {/* Progress bar */}
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)' }}>
            <div style={{ height: '100%', width: `${(step / TOTAL_STEPS) * 100}%`, background: 'linear-gradient(90deg, #16a34a, #4ade80)', transition: 'width 0.3s ease', borderRadius: '0 2px 2px 0' }} />
          </div>

          <div style={{ padding: '14px 18px 16px' }}>
            {/* Top row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <StepDots current={step} total={TOTAL_STEPS} onGoto={n => setStep(n)} />
              <button onClick={dismiss} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                Skip ×
              </button>
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              Step {step} of {TOTAL_STEPS}
            </div>

            {!current ? (
              <div style={{ color: '#64748b', fontSize: 13, padding: '6px 0' }}>Loading…</div>
            ) : (
              <>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px', letterSpacing: '-0.2px' }}>{current.title}</h3>
                <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 10px' }}>{current.body}</p>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, padding: '7px 11px', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12, color: '#86efac', lineHeight: 1.5 }}>{current.hint}</span>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {step > 1 && (
                <button onClick={goPrev} style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  ← Back
                </button>
              )}
              <button onClick={goNext} style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: 'linear-gradient(135deg, #16a34a, #15803d)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {step === TOTAL_STEPS ? 'Finish Tour ✓' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
