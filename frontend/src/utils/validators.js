// ABA routing-number checksum — catches most single-digit typos before a
// paycheck gets misrouted.
export function validRoutingNumber(rn) {
  if (!/^\d{9}$/.test(rn)) return false;
  const d = rn.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}
