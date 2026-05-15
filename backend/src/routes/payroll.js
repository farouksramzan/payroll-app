const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { calculateWithholding, STATE_TAX_RATES } = require('../services/taxCalculator');

const router = express.Router();
router.use(requireAuth);

const VALID_FREQ   = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const VALID_STATUS = ['single', 'married', 'hoh'];

// POST /api/payroll/calculate — stateless tax preview
router.post('/calculate', (req, res) => {
  const {
    grossWages,
    payFrequency,
    filingStatus,
    step2Checkbox,
    step3Children,
    step3Other,
    step4a,
    step4b,
    step4c,
    workState,
    ytdGross,
    sutaRate,
  } = req.body;

  if (!grossWages || !payFrequency || !filingStatus) {
    return res.status(400).json({ error: 'grossWages, payFrequency, and filingStatus are required' });
  }
  if (isNaN(grossWages) || parseFloat(grossWages) <= 0) {
    return res.status(400).json({ error: 'grossWages must be a positive number' });
  }
  if (!VALID_FREQ.includes(payFrequency)) {
    return res.status(400).json({ error: `payFrequency must be one of: ${VALID_FREQ.join(', ')}` });
  }
  if (!VALID_STATUS.includes(filingStatus)) {
    return res.status(400).json({ error: `filingStatus must be one of: ${VALID_STATUS.join(', ')}` });
  }

  const result = calculateWithholding({
    grossWages:    parseFloat(grossWages),
    payFrequency,
    filingStatus,
    step2Checkbox: !!step2Checkbox,
    step3Children: parseInt(step3Children || 0, 10),
    step3Other:    parseInt(step3Other    || 0, 10),
    step4a: parseFloat(step4a || 0),
    step4b: parseFloat(step4b || 0),
    step4c: parseFloat(step4c || 0),
    workState:  workState  || 'TX',
    ytdGross:   parseFloat(ytdGross || 0),
    sutaRate:   sutaRate != null ? parseFloat(sutaRate) : null,
  });

  res.json(result);
});

// GET /api/payroll/states — list of all supported states
router.get('/states', (req, res) => {
  const states = Object.entries(STATE_TAX_RATES).map(([code, data]) => ({
    code,
    name: data.name,
    hasSIT: !!data.sit,
    suiWageBase: data.sui?.wageBase,
    suiNewEmployerRate: data.sui?.newEmployerRate,
  }));
  res.json(states);
});

module.exports = router;
