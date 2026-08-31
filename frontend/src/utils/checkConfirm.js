export function deleteCheckConfirm({ name, amount, checkNumber }) {
  const who = name || 'this employee';
  return "Delete " + who + "'s " + amount + " check" + (checkNumber ? " (#" + checkNumber + ")" : "") + "? Its wages and tax liabilities are removed from every report. This cannot be undone.";
}
