import { useState } from 'react';

const STORAGE_KEY = 'payrolltaxpro_onboarding_v1';

const STEPS = [
  {
    icon: '🏦',
    title: 'Welcome to PayrollTax Pro',
    subtitle: 'A full-stack federal payroll tax engine — built entirely with Claude Code',
    content: (
      <div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
          This app handles end-to-end payroll processing — from entering hours to calculating
          federal and state taxes to tracking EFTPS deposit deadlines. Every line of code
          was written through conversation with Claude Code.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { label: 'Tax Engine', value: 'IRS 2026', sub: 'Pub 15-T compliant' },
            { label: 'Tax Types', value: '6 types', sub: 'FIT, SS, Med, FUTA, SUI, State' },
            { label: 'Architecture', value: 'Multi-user', sub: 'Full data isolation' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 12px', textAlign: 'center', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>{s.value}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{s.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: '⚙️',
    title: 'The Tax Engine',
    subtitle: 'Real calculations. Real IRS tables. Zero shortcuts.',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          {
            label: 'Federal Income Tax',
            detail: 'IRS Pub 15-T 2026 Percentage Method — standard deduction, 7 brackets, W-4 Step 2–4 adjustments, nearest-dollar rounding',
            color: '#3b82f6',
          },
          {
            label: 'FICA — Social Security & Medicare',
            detail: '$176,100 SS wage base cap tracked per employee YTD. Additional 0.9% Medicare kicks in over $200K. Employer match calculated separately.',
            color: '#8b5cf6',
          },
          {
            label: 'FUTA (Form 940)',
            detail: '0.6% net rate on first $7,000 per employee. Wage base cap tracked in real time. Liability rolls up to the Pay Liabilities tab.',
            color: '#f59e0b',
          },
          {
            label: 'State SUI + State Income Tax',
            detail: 'Per-state wage bases and new-employer rates for all 50 states. SIT uses flat or bracketed rates depending on the state.',
            color: '#10b981',
          },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div style={{ width: 4, borderRadius: 4, background: item.color, alignSelf: 'stretch', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: '📋',
    title: 'Running Payroll',
    subtitle: 'From hours to printed check in a few clicks',
    content: (
      <div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {[
            { step: '1', text: 'Select a company from the dashboard', icon: '🏢' },
            { step: '2', text: 'Go to the Pay Employees tab and find the pending pay period', icon: '📅' },
            { step: '3', text: 'Enter hours and rate inline — net pay estimates appear instantly', icon: '⌨️' },
            { step: '4', text: 'Click any check row to open the full breakdown: FIT, SS, Medicare, state tax, FUTA, SUI — all calculated live', icon: '🧾' },
            { step: '5', text: 'Hit Run Payroll to convert pending → printed. YTD updates immediately across all employees', icon: '✅' },
          ].map(item => (
            <div key={item.step} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{item.step}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item.icon} {item.text}</div>
            </div>
          ))}
        </div>
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#166534' }}>
          <strong>Try it now:</strong> The check modal updates taxes in real-time as you change hours or rate — FIT recalculated via the backend engine on every change.
        </div>
      </div>
    ),
  },
  {
    icon: '🗺️',
    title: 'What to Explore',
    subtitle: 'Key areas worth clicking through',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          {
            tab: 'Dashboard',
            desc: 'Upcoming payroll deadlines, EFTPS deposit calendar, YTD snapshot across all companies',
            badge: 'Start here',
            badgeColor: '#3b82f6',
          },
          {
            tab: 'Pay Employees tab → open a check',
            desc: 'Live tax breakdown. Edit any line item. YTD column accumulates across all pending + printed checks',
            badge: 'Most impressive',
            badgeColor: '#8b5cf6',
          },
          {
            tab: 'Pay Liabilities tab',
            desc: 'Tracks 941 (income + FICA) and 940 (FUTA) deposit obligations with IRS due dates and semiweekly/monthly schedules',
            badge: 'Tax compliance',
            badgeColor: '#f59e0b',
          },
          {
            tab: 'Employees → Employee profile',
            desc: 'Full W-4 (Steps 1–4), pay type, pay group assignment, bank account for direct deposit',
            badge: 'Employee setup',
            badgeColor: '#10b981',
          },
          {
            tab: 'Pay Groups (gear icon in Pay Employees)',
            desc: 'Weekly, biweekly, semimonthly, or monthly schedules. Pay date auto-calculates with business-day logic',
            badge: 'Scheduling',
            badgeColor: '#ec4899',
          },
        ].map(item => (
          <div key={item.tab} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              <span style={{ background: item.badgeColor + '22', color: item.badgeColor, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap' }}>{item.badge}</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>{item.tab}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

export default function OnboardingModal() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEY); } catch { return true; }
  });

  if (!visible) return null;

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    setVisible(false);
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-primary, #fff)',
        borderRadius: 16,
        width: '100%',
        maxWidth: 600,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '28px 28px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            {/* Step dots */}
            <div style={{ display: 'flex', gap: 6 }}>
              {STEPS.map((_, i) => (
                <div key={i} onClick={() => setStep(i)} style={{
                  width: i === step ? 20 : 7, height: 7, borderRadius: 4,
                  background: i === step ? 'var(--accent)' : 'var(--border)',
                  transition: 'all 0.2s', cursor: 'pointer',
                }} />
              ))}
            </div>
            <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
          </div>

          <div style={{ fontSize: 36, marginBottom: 12 }}>{current.icon}</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.2 }}>{current.title}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>{current.subtitle}</p>

          {/* Built with Claude Code badge — always visible */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: 20, padding: '4px 12px' }}>
            <span style={{ fontSize: 13 }}>🤖</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed' }}>Built entirely with Claude Code</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 28px', flex: 1 }}>
          {current.content}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 28px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={dismiss}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="btn btn-ghost"
                style={{ fontSize: 13 }}
              >
                ← Back
              </button>
            )}
            {isLast ? (
              <button
                onClick={dismiss}
                className="btn btn-primary"
                style={{ fontSize: 13, padding: '8px 20px' }}
              >
                Start Exploring →
              </button>
            ) : (
              <button
                onClick={() => setStep(s => s + 1)}
                className="btn btn-primary"
                style={{ fontSize: 13, padding: '8px 20px' }}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
