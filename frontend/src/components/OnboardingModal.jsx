import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';

const STORAGE_KEY = 'payrolltaxpro_tour_v3';
const TOTAL_STEPS = 7; // guide steps 1–7 (0 = welcome, 8 = done)

// ── Step definitions ──────────────────────────────────────────────────────────
function buildSteps(habibiId) {
  const base = `/clients/${habibiId}`;
  return [
    /* 0 — Welcome */ null, // handled inline
    {
      num: 1,
      title: '🏢 Your Client Dashboard',
      body: 'All your payroll clients live here. Each card shows the company name, upcoming payroll date, and deposit schedule. This is your command center.',
      hint: 'Find the Habibi Hookah Cafe card and click it to open the workspace.',
      hintDir: '↓',
      doNav: true,
      to: '/',
      toState: null,
    },
    {
      num: 2,
      title: '📋 Payroll Tab — All Pay Periods',
      body: "You're inside Habibi Hookah Cafe's workspace. The Payroll tab shows every pay period for this company — both upcoming pending ones at the top and completed printed checks below.",
      hint: 'Make sure the Payroll tab is selected at the top of the workspace.',
      hintDir: '↑',
      doNav: true,
      to: base,
      toState: { tab: 'payroll' },
    },
    {
      num: 3,
      title: '✅ Deposited / Printed Checks',
      body: 'Scroll down past the pending section to see printed checks — these are completed pay periods that have already been processed and deposited. Each row shows gross wages, net pay, taxes withheld, and check number.',
      hint: 'Scroll down ↓ to see rows with a green "Printed" or blue "Direct Deposit" status badge.',
      hintDir: '↓',
      doNav: false,
      to: null,
      toState: null,
    },
    {
      num: 4,
      title: '🧾 Live Tax Breakdown',
      body: 'Click any check row to open the full detail modal. You\'ll see the complete IRS calculation: Federal Income Tax (2026 Pub 15-T percentage method), Social Security (6.2%), Medicare (1.45%), employer match, FUTA (0.6%), and state SUI — all computed live. YTD columns accumulate from all printed + pending checks in the year.',
      hint: 'Click any printed check row in the table — the full breakdown opens instantly.',
      hintDir: '↗',
      doNav: false,
      to: null,
      toState: null,
    },
    {
      num: 5,
      title: '⏳ Pending Pay Periods',
      body: 'At the top of the Payroll tab are pending pay periods — the next upcoming payroll run. Type hours and rates directly into the table. Net pay and all taxes update in real time. When ready, click "Run Payroll" to convert them to printed checks and update year-to-date totals.',
      hint: 'Scroll back up ↑ — the pending section is above the printed checks.',
      hintDir: '↑',
      doNav: false,
      to: null,
      toState: null,
    },
    {
      num: 6,
      title: '🏦 Pay Liabilities',
      body: "Inside the Payroll tab there's a Liabilities sub-tab. It tracks your 941 deposit obligations (Federal Income Tax + FICA) and 940 deposits (FUTA) — complete with IRS due dates, semiweekly vs. monthly deposit schedules, and amounts owed per deposit period.",
      hint: 'Click the "Liabilities" sub-tab inside the Payroll section to see deposit obligations.',
      hintDir: '↑',
      doNav: false,
      to: null,
      toState: null,
    },
    {
      num: 7,
      title: '👥 Employees Tab',
      body: "Click the Employees tab to see all employee records. Each profile includes full W-4 settings (Steps 1–4), pay type (hourly or salary), pay group assignment, hourly rate or annual salary, and bank account details for ACH direct deposit. Click any employee to view or edit their info.",
      hint: 'Click the "Employees" tab at the top of the workspace.',
      hintDir: '↑',
      doNav: true,
      to: base,
      toState: { tab: 'employees' },
    },
  ];
}

// ── Dot progress indicator ────────────────────────────────────────────────────
function StepDots({ current, total, onGoto }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const active = stepNum === current;
        const done = stepNum < current;
        return (
          <div
            key={stepNum}
            onClick={() => onGoto(stepNum)}
            title={`Step ${stepNum}`}
            style={{
              width: active ? 20 : 7,
              height: 7,
              borderRadius: 4,
              background: active ? '#22c55e' : done ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.2)',
              transition: 'all 0.2s',
              cursor: 'pointer',
              flexShrink: 0,
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
  const location = useLocation();

  // 0 = welcome, 1–7 = guide steps, 8 = done, null = dismissed
  const [step, setStep] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dismissed') return null;
      return 0; // always show welcome on fresh load
    } catch {
      return 0;
    }
  });

  const [habibiId, setHabibiId] = useState(null);
  const [loadingHabibi, setLoadingHabibi] = useState(false);

  // Fetch Habibi's client ID when tour starts
  useEffect(() => {
    if (step === null || step === 0 || habibiId) return;
    setLoadingHabibi(true);
    api.getClients()
      .then(clients => {
        const habibi = clients.find(c =>
          c.businessName?.toLowerCase().includes('habibi') ||
          c.business_name?.toLowerCase().includes('habibi')
        );
        if (habibi) setHabibiId(habibi.id);
      })
      .catch(() => {})
      .finally(() => setLoadingHabibi(false));
  }, [step, habibiId]);

  // Auto-navigate when step changes and doNav is true
  useEffect(() => {
    if (!habibiId || step === null || step === 0 || step === 8) return;
    const steps = buildSteps(habibiId);
    const s = steps[step];
    if (!s || !s.doNav || !s.to) return;
    navigate(s.to, { state: s.toState, replace: false });
  }, [step, habibiId]); // eslint-disable-line

  const dismiss = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, 'dismissed'); } catch {}
    setStep(null);
  }, []);

  const startTour = useCallback(() => {
    setStep(1);
  }, []);

  const goNext = useCallback(() => {
    setStep(s => (s >= TOTAL_STEPS ? 8 : s + 1));
  }, []);

  const goPrev = useCallback(() => {
    setStep(s => (s <= 1 ? 1 : s - 1));
  }, []);

  const goToStep = useCallback((n) => {
    setStep(n);
  }, []);

  if (step === null) return null;

  // ── Welcome modal ─────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: '#0f172a',
          borderRadius: 20,
          width: '100%',
          maxWidth: 520,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          overflow: 'hidden',
        }}>
          {/* Green accent bar */}
          <div style={{ height: 4, background: 'linear-gradient(90deg, #16a34a, #4ade80)' }} />

          <div style={{ padding: '36px 36px 28px' }}>
            {/* Skip */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
              <button
                onClick={dismiss}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#94a3b8', fontSize: 12, fontWeight: 600, borderRadius: 20,
                  padding: '4px 12px', cursor: 'pointer', letterSpacing: '0.03em',
                }}
              >
                Skip tour ×
              </button>
            </div>

            <div style={{ fontSize: 40, marginBottom: 16 }}>👋</div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#f1f5f9', margin: '0 0 10px', letterSpacing: '-0.3px' }}>
              Welcome to PayrollTax Pro
            </h2>
            <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.75, margin: '0 0 28px' }}>
              We'll walk you through <strong style={{ color: '#4ade80' }}>Habibi Hookah Cafe</strong> — a real client
              in this account — so you can see exactly how the system works end-to-end:
              deposited checks, pending payroll, live tax breakdowns, liabilities, and employee management.
            </p>

            {/* What you'll see */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
              {[
                { icon: '✅', text: 'Deposited & pending checks with live tax estimates' },
                { icon: '🧾', text: 'Full IRS 2026 tax breakdown per check (FIT, SS, Medicare, FUTA)' },
                { icon: '🏦', text: '941 and 940 deposit schedules with IRS due dates' },
                { icon: '👥', text: 'Employee W-4 settings and direct deposit info' },
              ].map(item => (
                <div key={item.text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                  <span style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{item.text}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={dismiss}
                style={{
                  flex: 1, padding: '11px 0', borderRadius: 10,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Skip for now
              </button>
              <button
                onClick={startTour}
                style={{
                  flex: 2, padding: '11px 0', borderRadius: 10,
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  border: 'none', color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', letterSpacing: '0.01em',
                  boxShadow: '0 4px 20px rgba(22,163,74,0.35)',
                }}
              >
                Start Tour →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Done modal ────────────────────────────────────────────────────────────
  if (step === 8) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: '#0f172a',
          borderRadius: 20,
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          border: '1px solid rgba(34,197,94,0.25)',
          overflow: 'hidden',
          textAlign: 'center',
        }}>
          <div style={{ height: 4, background: 'linear-gradient(90deg, #16a34a, #4ade80)' }} />
          <div style={{ padding: '40px 36px 36px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: '0 0 12px' }}>
              You've seen it all!
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.75, margin: '0 0 10px' }}>
              That's the full PayrollTax Pro workflow — real IRS 2026 tax tables,
              EFTPS submission, ACH direct deposit, and <strong style={{ color: '#4ade80' }}>zero per-check fees</strong>.
            </p>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, margin: '0 0 28px' }}>
              Explore freely. Every number in this app uses real IRS logic — nothing is mocked.
            </p>
            <button
              onClick={dismiss}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                border: 'none', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', boxShadow: '0 4px 20px rgba(22,163,74,0.3)',
              }}
            >
              Start Exploring →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Guide steps 1–7 (floating bottom panel) ───────────────────────────────
  const steps = habibiId ? buildSteps(habibiId) : null;
  const current = steps?.[step];

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9990,
      width: '100%',
      maxWidth: 560,
      pointerEvents: 'none', // let clicks fall through to page
      padding: '0 16px',
    }}>
      <div style={{
        background: '#0f172a',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
        overflow: 'hidden',
        pointerEvents: 'all',
      }}>
        {/* Progress bar */}
        <div style={{ height: 3, background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            height: '100%',
            width: `${(step / TOTAL_STEPS) * 100}%`,
            background: 'linear-gradient(90deg, #16a34a, #4ade80)',
            transition: 'width 0.3s ease',
            borderRadius: '0 2px 2px 0',
          }} />
        </div>

        <div style={{ padding: '16px 20px 18px' }}>
          {/* Top row: dots + skip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <StepDots current={step} total={TOTAL_STEPS} onGoto={goToStep} />
            <button
              onClick={dismiss}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#64748b', fontSize: 11, fontWeight: 600, borderRadius: 20,
                padding: '3px 10px', cursor: 'pointer', letterSpacing: '0.04em',
              }}
            >
              Skip ×
            </button>
          </div>

          {/* Step label */}
          <div style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>
            Step {step} of {TOTAL_STEPS}
          </div>

          {loadingHabibi ? (
            <div style={{ color: '#64748b', fontSize: 13, padding: '8px 0' }}>Finding Habibi Hookah Cafe…</div>
          ) : !current ? (
            <div style={{ color: '#64748b', fontSize: 13, padding: '8px 0' }}>Loading step…</div>
          ) : (
            <>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9', margin: '0 0 7px', letterSpacing: '-0.2px' }}>
                {current.title}
              </h3>
              <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.65, margin: '0 0 12px' }}>
                {current.body}
              </p>

              {/* Action hint */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 8, padding: '8px 12px',
                marginBottom: 14,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
                <span style={{ fontSize: 12, color: '#86efac', lineHeight: 1.5 }}>{current.hint}</span>
              </div>
            </>
          )}

          {/* Nav buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {step > 1 && (
              <button
                onClick={goPrev}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}
            <button
              onClick={goNext}
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8,
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', letterSpacing: '0.01em',
              }}
            >
              {step === TOTAL_STEPS ? 'Finish Tour ✓' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
