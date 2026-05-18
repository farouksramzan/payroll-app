'use strict';

// Federal holidays observed by the IRS (bank holiday = no EFTPS transactions)
const HOLIDAYS = new Set([
  // 2024
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19',
  '2024-07-04','2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  // 2025
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19',
  '2025-07-04','2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  // 2026
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19',
  '2026-07-03','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
]);

function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }
function isHoliday(d) { return HOLIDAYS.has(d.toISOString().slice(0, 10)); }
function isBusinessDay(d) { return !isWeekend(d) && !isHoliday(d); }

// Returns the same or next business day
function toBusinessDay(d) {
  const r = new Date(d);
  while (!isBusinessDay(r)) r.setDate(r.getDate() + 1);
  return r;
}

// IRS semi-weekly and monthly settlement due dates
// payDate = 'YYYY-MM-DD' string of when employee is paid
// depositSchedule = 'monthly' | 'semiweekly'
function calcSettlementDueDate(payDate, depositSchedule) {
  if (!payDate) return null;
  const d = new Date(payDate + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

  let due;
  if (depositSchedule === 'semiweekly') {
    // Wed/Thu/Fri payroll → deposit by following Wednesday
    if (dow >= 3 && dow <= 5) {
      const daysToWed = (3 - dow + 7) % 7 || 7;
      due = new Date(d); due.setDate(d.getDate() + daysToWed);
    } else {
      // Sat/Sun/Mon/Tue payroll → deposit by following Friday
      const daysToFri = (5 - dow + 7) % 7 || 7;
      due = new Date(d); due.setDate(d.getDate() + daysToFri);
    }
  } else {
    // Monthly: 15th of following month
    due = new Date(d.getFullYear(), d.getMonth() + 1, 15);
  }

  return toBusinessDay(due).toISOString().slice(0, 10);
}

module.exports = { calcSettlementDueDate, toBusinessDay, isBusinessDay, isHoliday };
