'use strict';

/**
 * 2026 State Unemployment Insurance (SUI) and State Income Tax (SIT) rates.
 *
 * SUI data: wage base and new-employer rate for all 50 states + DC.
 * SIT data: annual taxable income brackets (single/married/hoh) and standard deductions.
 *   - type 'none': no state income tax on wages
 *   - type 'flat': single flat rate applied to all wages
 *   - type 'brackets': progressive brackets (same structure as federal)
 *   - estimated: true means values are 2025 data or estimates pending 2026 publication
 *
 * Withholding formula (for 'brackets' type):
 *   1. annualWages = grossWages × payPeriods
 *   2. taxableAnnual = max(0, annualWages − standardDeduction[filingStatus])
 *   3. annualTax = apply brackets to taxableAnnual
 *   4. perPeriodSIT = annualTax / payPeriods
 *
 * For 'flat' type:
 *   perPeriodSIT = grossWages × rate
 *
 * Sources: State revenue department publications, Tax Foundation 2025/2026 data.
 * Always verify against your state's employer withholding tables.
 */

const STATE_TAX_RATES = {
  AL: {
    name: 'Alabama',
    sui: { wageBase: 8000, newEmployerRate: 0.027 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 2500, married: 7500, hoh: 4700 },
      brackets: {
        single:  [{ min: 0, max: 500, rate: 0.02 }, { min: 500, max: 3000, rate: 0.04 }, { min: 3000, max: Infinity, rate: 0.05 }],
        married: [{ min: 0, max: 1000, rate: 0.02 }, { min: 1000, max: 6000, rate: 0.04 }, { min: 6000, max: Infinity, rate: 0.05 }],
        hoh:     [{ min: 0, max: 500, rate: 0.02 }, { min: 500, max: 3000, rate: 0.04 }, { min: 3000, max: Infinity, rate: 0.05 }],
      },
    },
  },

  AK: {
    name: 'Alaska',
    sui: { wageBase: 47100, newEmployerRate: 0.01 },
    sit: null,
  },

  AZ: {
    name: 'Arizona',
    sui: { wageBase: 8000, newEmployerRate: 0.02 },
    sit: { type: 'flat', rate: 0.025 },
  },

  AR: {
    name: 'Arkansas',
    sui: { wageBase: 7000, newEmployerRate: 0.031 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 2200, married: 4400, hoh: 2200 },
      brackets: {
        single:  [{ min: 0, max: 4999, rate: 0.02 }, { min: 4999, max: 9999, rate: 0.04 }, { min: 9999, max: Infinity, rate: 0.049 }],
        married: [{ min: 0, max: 4999, rate: 0.02 }, { min: 4999, max: 9999, rate: 0.04 }, { min: 9999, max: Infinity, rate: 0.049 }],
        hoh:     [{ min: 0, max: 4999, rate: 0.02 }, { min: 4999, max: 9999, rate: 0.04 }, { min: 9999, max: Infinity, rate: 0.049 }],
      },
    },
  },

  CA: {
    name: 'California',
    sui: { wageBase: 7000, newEmployerRate: 0.034 },
    sit: {
      type: 'brackets',
      standardDeduction: { single: 5363, married: 10726, hoh: 10726 },
      brackets: {
        single: [
          { min: 0,       max: 10412,   rate: 0.01  },
          { min: 10412,   max: 24684,   rate: 0.02  },
          { min: 24684,   max: 38959,   rate: 0.04  },
          { min: 38959,   max: 54081,   rate: 0.06  },
          { min: 54081,   max: 68350,   rate: 0.08  },
          { min: 68350,   max: 349137,  rate: 0.093 },
          { min: 349137,  max: 418961,  rate: 0.103 },
          { min: 418961,  max: 698274,  rate: 0.113 },
          { min: 698274,  max: Infinity, rate: 0.123 },
        ],
        married: [
          { min: 0,       max: 20824,   rate: 0.01  },
          { min: 20824,   max: 49368,   rate: 0.02  },
          { min: 49368,   max: 77918,   rate: 0.04  },
          { min: 77918,   max: 108162,  rate: 0.06  },
          { min: 108162,  max: 136700,  rate: 0.08  },
          { min: 136700,  max: 698274,  rate: 0.093 },
          { min: 698274,  max: 837922,  rate: 0.103 },
          { min: 837922,  max: 1000000, rate: 0.113 },
          { min: 1000000, max: Infinity, rate: 0.123 },
        ],
        hoh: [
          { min: 0,       max: 20839,   rate: 0.01  },
          { min: 20839,   max: 49368,   rate: 0.02  },
          { min: 49368,   max: 63644,   rate: 0.04  },
          { min: 63644,   max: 78765,   rate: 0.06  },
          { min: 78765,   max: 93037,   rate: 0.08  },
          { min: 93037,   max: 474823,  rate: 0.093 },
          { min: 474823,  max: 569790,  rate: 0.103 },
          { min: 569790,  max: 999999,  rate: 0.113 },
          { min: 999999,  max: Infinity, rate: 0.123 },
        ],
      },
    },
  },

  CO: {
    name: 'Colorado',
    sui: { wageBase: 23800, newEmployerRate: 0.017 },
    sit: { type: 'flat', rate: 0.044 },
  },

  CT: {
    name: 'Connecticut',
    sui: { wageBase: 25000, newEmployerRate: 0.03 },
    sit: {
      type: 'brackets',
      standardDeduction: { single: 15000, married: 24000, hoh: 19000 },
      brackets: {
        single: [
          { min: 0,       max: 10000,  rate: 0.02  },
          { min: 10000,   max: 50000,  rate: 0.045 },
          { min: 50000,   max: 100000, rate: 0.055 },
          { min: 100000,  max: 200000, rate: 0.060 },
          { min: 200000,  max: 250000, rate: 0.065 },
          { min: 250000,  max: 500000, rate: 0.069 },
          { min: 500000,  max: Infinity, rate: 0.0699 },
        ],
        married: [
          { min: 0,       max: 20000,  rate: 0.02  },
          { min: 20000,   max: 100000, rate: 0.045 },
          { min: 100000,  max: 200000, rate: 0.055 },
          { min: 200000,  max: 400000, rate: 0.060 },
          { min: 400000,  max: 500000, rate: 0.065 },
          { min: 500000,  max: 1000000, rate: 0.069 },
          { min: 1000000, max: Infinity, rate: 0.0699 },
        ],
        hoh: [
          { min: 0,       max: 16000,  rate: 0.02  },
          { min: 16000,   max: 80000,  rate: 0.045 },
          { min: 80000,   max: 160000, rate: 0.055 },
          { min: 160000,  max: 320000, rate: 0.060 },
          { min: 320000,  max: 400000, rate: 0.065 },
          { min: 400000,  max: 800000, rate: 0.069 },
          { min: 800000,  max: Infinity, rate: 0.0699 },
        ],
      },
    },
  },

  DE: {
    name: 'Delaware',
    sui: { wageBase: 14500, newEmployerRate: 0.016 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 3250, married: 6500, hoh: 3250 },
      brackets: {
        single: [
          { min: 0,     max: 2000,  rate: 0     },
          { min: 2000,  max: 5000,  rate: 0.022 },
          { min: 5000,  max: 10000, rate: 0.039 },
          { min: 10000, max: 20000, rate: 0.048 },
          { min: 20000, max: 25000, rate: 0.052 },
          { min: 25000, max: 60000, rate: 0.055 },
          { min: 60000, max: Infinity, rate: 0.066 },
        ],
        married: [
          { min: 0,     max: 2000,  rate: 0     },
          { min: 2000,  max: 5000,  rate: 0.022 },
          { min: 5000,  max: 10000, rate: 0.039 },
          { min: 10000, max: 20000, rate: 0.048 },
          { min: 20000, max: 25000, rate: 0.052 },
          { min: 25000, max: 60000, rate: 0.055 },
          { min: 60000, max: Infinity, rate: 0.066 },
        ],
        hoh: [
          { min: 0,     max: 2000,  rate: 0     },
          { min: 2000,  max: 5000,  rate: 0.022 },
          { min: 5000,  max: 10000, rate: 0.039 },
          { min: 10000, max: 20000, rate: 0.048 },
          { min: 20000, max: 25000, rate: 0.052 },
          { min: 25000, max: 60000, rate: 0.055 },
          { min: 60000, max: Infinity, rate: 0.066 },
        ],
      },
    },
  },

  DC: {
    name: 'Washington D.C.',
    sui: { wageBase: 9000, newEmployerRate: 0.027 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 12950, married: 25900, hoh: 19400 },
      brackets: {
        single: [
          { min: 0,       max: 10000,  rate: 0.04  },
          { min: 10000,   max: 40000,  rate: 0.06  },
          { min: 40000,   max: 60000,  rate: 0.065 },
          { min: 60000,   max: 350000, rate: 0.085 },
          { min: 350000,  max: 1000000, rate: 0.0925 },
          { min: 1000000, max: Infinity, rate: 0.1075 },
        ],
        married: [
          { min: 0,       max: 10000,  rate: 0.04  },
          { min: 10000,   max: 40000,  rate: 0.06  },
          { min: 40000,   max: 60000,  rate: 0.065 },
          { min: 60000,   max: 350000, rate: 0.085 },
          { min: 350000,  max: 1000000, rate: 0.0925 },
          { min: 1000000, max: Infinity, rate: 0.1075 },
        ],
        hoh: [
          { min: 0,       max: 10000,  rate: 0.04  },
          { min: 10000,   max: 40000,  rate: 0.06  },
          { min: 40000,   max: 60000,  rate: 0.065 },
          { min: 60000,   max: 350000, rate: 0.085 },
          { min: 350000,  max: 1000000, rate: 0.0925 },
          { min: 1000000, max: Infinity, rate: 0.1075 },
        ],
      },
    },
  },

  FL: {
    name: 'Florida',
    sui: { wageBase: 7000, newEmployerRate: 0.027 },
    sit: null,
  },

  GA: {
    name: 'Georgia',
    sui: { wageBase: 9500, newEmployerRate: 0.027 },
    sit: { type: 'flat', rate: 0.0499 },
  },

  HI: {
    name: 'Hawaii',
    sui: { wageBase: 59100, newEmployerRate: 0.04 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 2200, married: 4400, hoh: 3212 },
      brackets: {
        single: [
          { min: 0,       max: 2400,   rate: 0.014 },
          { min: 2400,    max: 4800,   rate: 0.032 },
          { min: 4800,    max: 9600,   rate: 0.055 },
          { min: 9600,    max: 14400,  rate: 0.064 },
          { min: 14400,   max: 19200,  rate: 0.068 },
          { min: 19200,   max: 24000,  rate: 0.072 },
          { min: 24000,   max: 48000,  rate: 0.076 },
          { min: 48000,   max: 150000, rate: 0.079 },
          { min: 150000,  max: 175000, rate: 0.0825 },
          { min: 175000,  max: 200000, rate: 0.09   },
          { min: 200000,  max: Infinity, rate: 0.11  },
        ],
        married: [
          { min: 0,       max: 4800,   rate: 0.014 },
          { min: 4800,    max: 9600,   rate: 0.032 },
          { min: 9600,    max: 19200,  rate: 0.055 },
          { min: 19200,   max: 28800,  rate: 0.064 },
          { min: 28800,   max: 38400,  rate: 0.068 },
          { min: 38400,   max: 48000,  rate: 0.072 },
          { min: 48000,   max: 96000,  rate: 0.076 },
          { min: 96000,   max: 300000, rate: 0.079 },
          { min: 300000,  max: 350000, rate: 0.0825 },
          { min: 350000,  max: 400000, rate: 0.09   },
          { min: 400000,  max: Infinity, rate: 0.11  },
        ],
        hoh: [
          { min: 0,       max: 2400,   rate: 0.014 },
          { min: 2400,    max: 4800,   rate: 0.032 },
          { min: 4800,    max: 9600,   rate: 0.055 },
          { min: 9600,    max: 14400,  rate: 0.064 },
          { min: 14400,   max: 19200,  rate: 0.068 },
          { min: 19200,   max: 24000,  rate: 0.072 },
          { min: 24000,   max: 48000,  rate: 0.076 },
          { min: 48000,   max: 150000, rate: 0.079 },
          { min: 150000,  max: 175000, rate: 0.0825 },
          { min: 175000,  max: 200000, rate: 0.09   },
          { min: 200000,  max: Infinity, rate: 0.11  },
        ],
      },
    },
  },

  ID: {
    name: 'Idaho',
    sui: { wageBase: 53500, newEmployerRate: 0.01044 },
    sit: { type: 'flat', rate: 0.05695 },
  },

  IL: {
    name: 'Illinois',
    sui: { wageBase: 13590, newEmployerRate: 0.03525 },
    sit: { type: 'flat', rate: 0.0495 },
  },

  IN: {
    name: 'Indiana',
    sui: { wageBase: 9500, newEmployerRate: 0.025 },
    sit: { type: 'flat', rate: 0.0305 },
  },

  IA: {
    name: 'Iowa',
    sui: { wageBase: 38200, newEmployerRate: 0.01 },
    sit: { type: 'flat', rate: 0.038 },
  },

  KS: {
    name: 'Kansas',
    sui: { wageBase: 14000, newEmployerRate: 0.027 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 3500, married: 8000, hoh: 6000 },
      brackets: {
        single:  [{ min: 0, max: 15000, rate: 0.031 }, { min: 15000, max: Infinity, rate: 0.057 }],
        married: [{ min: 0, max: 30000, rate: 0.031 }, { min: 30000, max: Infinity, rate: 0.057 }],
        hoh:     [{ min: 0, max: 15000, rate: 0.031 }, { min: 15000, max: Infinity, rate: 0.057 }],
      },
    },
  },

  KY: {
    name: 'Kentucky',
    sui: { wageBase: 11400, newEmployerRate: 0.027 },
    sit: { type: 'flat', rate: 0.04 },
  },

  LA: {
    name: 'Louisiana',
    sui: { wageBase: 7700, newEmployerRate: 0.0126 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 4500, married: 9000, hoh: 4500 },
      brackets: {
        single:  [{ min: 0, max: 12500, rate: 0.0185 }, { min: 12500, max: 50000, rate: 0.035 }, { min: 50000, max: Infinity, rate: 0.0425 }],
        married: [{ min: 0, max: 25000, rate: 0.0185 }, { min: 25000, max: 100000, rate: 0.035 }, { min: 100000, max: Infinity, rate: 0.0425 }],
        hoh:     [{ min: 0, max: 12500, rate: 0.0185 }, { min: 12500, max: 50000, rate: 0.035 }, { min: 50000, max: Infinity, rate: 0.0425 }],
      },
    },
  },

  ME: {
    name: 'Maine',
    sui: { wageBase: 12000, newEmployerRate: 0.027 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 14600, married: 29200, hoh: 21900 },
      brackets: {
        single: [
          { min: 0,      max: 24500,  rate: 0.058 },
          { min: 24500,  max: 58050,  rate: 0.0675 },
          { min: 58050,  max: Infinity, rate: 0.0715 },
        ],
        married: [
          { min: 0,      max: 49050,  rate: 0.058 },
          { min: 49050,  max: 116100, rate: 0.0675 },
          { min: 116100, max: Infinity, rate: 0.0715 },
        ],
        hoh: [
          { min: 0,      max: 36750,  rate: 0.058 },
          { min: 36750,  max: 87075,  rate: 0.0675 },
          { min: 87075,  max: Infinity, rate: 0.0715 },
        ],
      },
    },
  },

  MD: {
    name: 'Maryland',
    sui: { wageBase: 8500, newEmployerRate: 0.023 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 2400, married: 4800, hoh: 2400 },
      brackets: {
        single: [
          { min: 0,       max: 1000,   rate: 0.02   },
          { min: 1000,    max: 2000,   rate: 0.03   },
          { min: 2000,    max: 3000,   rate: 0.04   },
          { min: 3000,    max: 100000, rate: 0.0475 },
          { min: 100000,  max: 125000, rate: 0.05   },
          { min: 125000,  max: 150000, rate: 0.0525 },
          { min: 150000,  max: 250000, rate: 0.055  },
          { min: 250000,  max: Infinity, rate: 0.0575 },
        ],
        married: [
          { min: 0,       max: 1000,   rate: 0.02   },
          { min: 1000,    max: 2000,   rate: 0.03   },
          { min: 2000,    max: 3000,   rate: 0.04   },
          { min: 3000,    max: 150000, rate: 0.0475 },
          { min: 150000,  max: 175000, rate: 0.05   },
          { min: 175000,  max: 225000, rate: 0.0525 },
          { min: 225000,  max: 300000, rate: 0.055  },
          { min: 300000,  max: Infinity, rate: 0.0575 },
        ],
        hoh: [
          { min: 0,       max: 1000,   rate: 0.02   },
          { min: 1000,    max: 2000,   rate: 0.03   },
          { min: 2000,    max: 3000,   rate: 0.04   },
          { min: 3000,    max: 150000, rate: 0.0475 },
          { min: 150000,  max: 175000, rate: 0.05   },
          { min: 175000,  max: 225000, rate: 0.0525 },
          { min: 225000,  max: 300000, rate: 0.055  },
          { min: 300000,  max: Infinity, rate: 0.0575 },
        ],
      },
    },
  },

  MA: {
    name: 'Massachusetts',
    sui: { wageBase: 15000, newEmployerRate: 0.0242 },
    sit: { type: 'flat', rate: 0.05 },
  },

  MI: {
    name: 'Michigan',
    sui: { wageBase: 9500, newEmployerRate: 0.027 },
    sit: { type: 'flat', rate: 0.0425 },
  },

  MN: {
    name: 'Minnesota',
    sui: { wageBase: 42000, newEmployerRate: 0.011 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 14575, married: 29150, hoh: 21800 },
      brackets: {
        single: [
          { min: 0,       max: 31690,  rate: 0.0535 },
          { min: 31690,   max: 104090, rate: 0.068  },
          { min: 104090,  max: 193240, rate: 0.0785 },
          { min: 193240,  max: Infinity, rate: 0.0985 },
        ],
        married: [
          { min: 0,       max: 46330,  rate: 0.0535 },
          { min: 46330,   max: 184040, rate: 0.068  },
          { min: 184040,  max: 320090, rate: 0.0785 },
          { min: 320090,  max: Infinity, rate: 0.0985 },
        ],
        hoh: [
          { min: 0,       max: 39050,  rate: 0.0535 },
          { min: 39050,   max: 157430, rate: 0.068  },
          { min: 157430,  max: 256665, rate: 0.0785 },
          { min: 256665,  max: Infinity, rate: 0.0985 },
        ],
      },
    },
  },

  MS: {
    name: 'Mississippi',
    sui: { wageBase: 14000, newEmployerRate: 0.01 },
    sit: { type: 'flat', rate: 0.047, estimated: true },
  },

  MO: {
    name: 'Missouri',
    sui: { wageBase: 10000, newEmployerRate: 0.02376 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 14600, married: 29200, hoh: 21900 },
      brackets: {
        single: [
          { min: 0,    max: 1207,  rate: 0     },
          { min: 1207, max: 2414,  rate: 0.02  },
          { min: 2414, max: 3622,  rate: 0.025 },
          { min: 3622, max: 4829,  rate: 0.03  },
          { min: 4829, max: 6036,  rate: 0.035 },
          { min: 6036, max: 7244,  rate: 0.04  },
          { min: 7244, max: 8450,  rate: 0.045 },
          { min: 8450, max: Infinity, rate: 0.047 },
        ],
        married: [
          { min: 0,    max: 1207,  rate: 0     },
          { min: 1207, max: 2414,  rate: 0.02  },
          { min: 2414, max: 3622,  rate: 0.025 },
          { min: 3622, max: 4829,  rate: 0.03  },
          { min: 4829, max: 6036,  rate: 0.035 },
          { min: 6036, max: 7244,  rate: 0.04  },
          { min: 7244, max: 8450,  rate: 0.045 },
          { min: 8450, max: Infinity, rate: 0.047 },
        ],
        hoh: [
          { min: 0,    max: 1207,  rate: 0     },
          { min: 1207, max: 2414,  rate: 0.02  },
          { min: 2414, max: 3622,  rate: 0.025 },
          { min: 3622, max: 4829,  rate: 0.03  },
          { min: 4829, max: 6036,  rate: 0.035 },
          { min: 6036, max: 7244,  rate: 0.04  },
          { min: 7244, max: 8450,  rate: 0.045 },
          { min: 8450, max: Infinity, rate: 0.047 },
        ],
      },
    },
  },

  MT: {
    name: 'Montana',
    sui: { wageBase: 43000, newEmployerRate: 0.01 },
    sit: { type: 'flat', rate: 0.059, estimated: true },
  },

  NE: {
    name: 'Nebraska',
    sui: { wageBase: 9000, newEmployerRate: 0.0125 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 7900, married: 15800, hoh: 11800 },
      brackets: {
        single: [
          { min: 0,      max: 3700,   rate: 0.0246 },
          { min: 3700,   max: 22170,  rate: 0.0351 },
          { min: 22170,  max: 35730,  rate: 0.0501 },
          { min: 35730,  max: Infinity, rate: 0.0664 },
        ],
        married: [
          { min: 0,      max: 7390,   rate: 0.0246 },
          { min: 7390,   max: 44350,  rate: 0.0351 },
          { min: 44350,  max: 71460,  rate: 0.0501 },
          { min: 71460,  max: Infinity, rate: 0.0664 },
        ],
        hoh: [
          { min: 0,      max: 3700,   rate: 0.0246 },
          { min: 3700,   max: 22170,  rate: 0.0351 },
          { min: 22170,  max: 35730,  rate: 0.0501 },
          { min: 35730,  max: Infinity, rate: 0.0664 },
        ],
      },
    },
  },

  NV: {
    name: 'Nevada',
    sui: { wageBase: 40600, newEmployerRate: 0.0295 },
    sit: null,
  },

  NH: {
    name: 'New Hampshire',
    sui: { wageBase: 14000, newEmployerRate: 0.017 },
    sit: null,
  },

  NJ: {
    name: 'New Jersey',
    sui: { wageBase: 42300, newEmployerRate: 0.028 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 1000, married: 2000, hoh: 1000 },
      brackets: {
        single: [
          { min: 0,       max: 20000,  rate: 0.014   },
          { min: 20000,   max: 35000,  rate: 0.0175  },
          { min: 35000,   max: 40000,  rate: 0.035   },
          { min: 40000,   max: 75000,  rate: 0.05525 },
          { min: 75000,   max: 500000, rate: 0.0637  },
          { min: 500000,  max: 1000000, rate: 0.0897 },
          { min: 1000000, max: Infinity, rate: 0.1075 },
        ],
        married: [
          { min: 0,       max: 20000,  rate: 0.014   },
          { min: 20000,   max: 50000,  rate: 0.0175  },
          { min: 50000,   max: 70000,  rate: 0.0245  },
          { min: 70000,   max: 80000,  rate: 0.035   },
          { min: 80000,   max: 150000, rate: 0.05525 },
          { min: 150000,  max: 500000, rate: 0.0637  },
          { min: 500000,  max: 1000000, rate: 0.0897 },
          { min: 1000000, max: Infinity, rate: 0.1075 },
        ],
        hoh: [
          { min: 0,       max: 20000,  rate: 0.014   },
          { min: 20000,   max: 35000,  rate: 0.0175  },
          { min: 35000,   max: 40000,  rate: 0.035   },
          { min: 40000,   max: 75000,  rate: 0.05525 },
          { min: 75000,   max: 500000, rate: 0.0637  },
          { min: 500000,  max: 1000000, rate: 0.0897 },
          { min: 1000000, max: Infinity, rate: 0.1075 },
        ],
      },
    },
  },

  NM: {
    name: 'New Mexico',
    sui: { wageBase: 30100, newEmployerRate: 0.01 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 14600, married: 29200, hoh: 21900 },
      brackets: {
        single: [
          { min: 0,      max: 5500,   rate: 0.017 },
          { min: 5500,   max: 11000,  rate: 0.032 },
          { min: 11000,  max: 16000,  rate: 0.047 },
          { min: 16000,  max: 210000, rate: 0.049 },
          { min: 210000, max: Infinity, rate: 0.059 },
        ],
        married: [
          { min: 0,      max: 8000,   rate: 0.017 },
          { min: 8000,   max: 16000,  rate: 0.032 },
          { min: 16000,  max: 24000,  rate: 0.047 },
          { min: 24000,  max: 315000, rate: 0.049 },
          { min: 315000, max: Infinity, rate: 0.059 },
        ],
        hoh: [
          { min: 0,      max: 8000,   rate: 0.017 },
          { min: 8000,   max: 16000,  rate: 0.032 },
          { min: 16000,  max: 24000,  rate: 0.047 },
          { min: 24000,  max: 315000, rate: 0.049 },
          { min: 315000, max: Infinity, rate: 0.059 },
        ],
      },
    },
  },

  NY: {
    name: 'New York',
    sui: { wageBase: 12500, newEmployerRate: 0.032 },
    sit: {
      type: 'brackets',
      standardDeduction: { single: 8000, married: 16050, hoh: 11200 },
      brackets: {
        single: [
          { min: 0,         max: 17150,    rate: 0.04   },
          { min: 17150,     max: 23600,    rate: 0.045  },
          { min: 23600,     max: 27900,    rate: 0.0525 },
          { min: 27900,     max: 161550,   rate: 0.0585 },
          { min: 161550,    max: 323200,   rate: 0.0625 },
          { min: 323200,    max: 2155350,  rate: 0.0685 },
          { min: 2155350,   max: Infinity, rate: 0.109  },
        ],
        married: [
          { min: 0,         max: 27900,    rate: 0.04   },
          { min: 27900,     max: 43550,    rate: 0.045  },
          { min: 43550,     max: 161550,   rate: 0.0525 },
          { min: 161550,    max: 323200,   rate: 0.0585 },
          { min: 323200,    max: 2155350,  rate: 0.0625 },
          { min: 2155350,   max: Infinity, rate: 0.0685 },
        ],
        hoh: [
          { min: 0,         max: 17150,    rate: 0.04   },
          { min: 17150,     max: 23600,    rate: 0.045  },
          { min: 23600,     max: 27900,    rate: 0.0525 },
          { min: 27900,     max: 161550,   rate: 0.0585 },
          { min: 161550,    max: 323200,   rate: 0.0625 },
          { min: 323200,    max: 2155350,  rate: 0.0685 },
          { min: 2155350,   max: Infinity, rate: 0.109  },
        ],
      },
    },
  },

  NC: {
    name: 'North Carolina',
    sui: { wageBase: 31400, newEmployerRate: 0.01 },
    sit: { type: 'flat', rate: 0.0399 },
  },

  ND: {
    name: 'North Dakota',
    sui: { wageBase: 43800, newEmployerRate: 0.0109 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 14600, married: 29200, hoh: 21900 },
      brackets: {
        single:  [{ min: 0, max: 44725, rate: 0.0195 }, { min: 44725, max: 225975, rate: 0.0295 }, { min: 225975, max: Infinity, rate: 0.025 }],
        married: [{ min: 0, max: 74750, rate: 0.0195 }, { min: 74750, max: 275925, rate: 0.0295 }, { min: 275925, max: Infinity, rate: 0.025 }],
        hoh:     [{ min: 0, max: 44725, rate: 0.0195 }, { min: 44725, max: 225975, rate: 0.0295 }, { min: 225975, max: Infinity, rate: 0.025 }],
      },
    },
  },

  OH: {
    name: 'Ohio',
    sui: { wageBase: 9000, newEmployerRate: 0.027 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 0, married: 0, hoh: 0 },
      brackets: {
        single:  [{ min: 0, max: 26050, rate: 0 }, { min: 26050, max: 100000, rate: 0.0275 }, { min: 100000, max: Infinity, rate: 0.035 }],
        married: [{ min: 0, max: 26050, rate: 0 }, { min: 26050, max: 100000, rate: 0.0275 }, { min: 100000, max: Infinity, rate: 0.035 }],
        hoh:     [{ min: 0, max: 26050, rate: 0 }, { min: 26050, max: 100000, rate: 0.0275 }, { min: 100000, max: Infinity, rate: 0.035 }],
      },
    },
  },

  OK: {
    name: 'Oklahoma',
    sui: { wageBase: 24800, newEmployerRate: 0.015 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 6350, married: 12700, hoh: 9350 },
      brackets: {
        single: [
          { min: 0,     max: 1000,  rate: 0.005 },
          { min: 1000,  max: 2500,  rate: 0.01  },
          { min: 2500,  max: 3750,  rate: 0.02  },
          { min: 3750,  max: 4900,  rate: 0.03  },
          { min: 4900,  max: 7200,  rate: 0.04  },
          { min: 7200,  max: Infinity, rate: 0.0475 },
        ],
        married: [
          { min: 0,     max: 2000,  rate: 0.005 },
          { min: 2000,  max: 5000,  rate: 0.01  },
          { min: 5000,  max: 7500,  rate: 0.02  },
          { min: 7500,  max: 9800,  rate: 0.03  },
          { min: 9800,  max: 12200, rate: 0.04  },
          { min: 12200, max: Infinity, rate: 0.0475 },
        ],
        hoh: [
          { min: 0,     max: 1000,  rate: 0.005 },
          { min: 1000,  max: 2500,  rate: 0.01  },
          { min: 2500,  max: 3750,  rate: 0.02  },
          { min: 3750,  max: 4900,  rate: 0.03  },
          { min: 4900,  max: 7200,  rate: 0.04  },
          { min: 7200,  max: Infinity, rate: 0.0475 },
        ],
      },
    },
  },

  OR: {
    name: 'Oregon',
    sui: { wageBase: 55300, newEmployerRate: 0.021 },
    sit: {
      type: 'brackets',
      standardDeduction: { single: 2270, married: 4545, hoh: 3640 },
      brackets: {
        single: [
          { min: 0,       max: 17400,  rate: 0.0475 },
          { min: 17400,   max: 43650,  rate: 0.0675 },
          { min: 43650,   max: 250000, rate: 0.0875 },
          { min: 250000,  max: Infinity, rate: 0.099 },
        ],
        married: [
          { min: 0,       max: 34800,  rate: 0.0475 },
          { min: 34800,   max: 87300,  rate: 0.0675 },
          { min: 87300,   max: 500000, rate: 0.0875 },
          { min: 500000,  max: Infinity, rate: 0.099 },
        ],
        hoh: [
          { min: 0,       max: 17400,  rate: 0.0475 },
          { min: 17400,   max: 43650,  rate: 0.0675 },
          { min: 43650,   max: 250000, rate: 0.0875 },
          { min: 250000,  max: Infinity, rate: 0.099 },
        ],
      },
    },
  },

  PA: {
    name: 'Pennsylvania',
    sui: { wageBase: 10000, newEmployerRate: 0.03822 },
    sit: { type: 'flat', rate: 0.0307 },
  },

  RI: {
    name: 'Rhode Island',
    sui: { wageBase: 28400, newEmployerRate: 0.0119 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 10550, married: 21100, hoh: 15825 },
      brackets: {
        single: [
          { min: 0,      max: 73450,  rate: 0.0375 },
          { min: 73450,  max: 166950, rate: 0.0475 },
          { min: 166950, max: Infinity, rate: 0.0599 },
        ],
        married: [
          { min: 0,      max: 73450,  rate: 0.0375 },
          { min: 73450,  max: 166950, rate: 0.0475 },
          { min: 166950, max: Infinity, rate: 0.0599 },
        ],
        hoh: [
          { min: 0,      max: 73450,  rate: 0.0375 },
          { min: 73450,  max: 166950, rate: 0.0475 },
          { min: 166950, max: Infinity, rate: 0.0599 },
        ],
      },
    },
  },

  SC: {
    name: 'South Carolina',
    sui: { wageBase: 14000, newEmployerRate: 0.0058 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 14600, married: 29200, hoh: 21900 },
      brackets: {
        single:  [{ min: 0, max: 3460, rate: 0 }, { min: 3460, max: Infinity, rate: 0.064 }],
        married: [{ min: 0, max: 3460, rate: 0 }, { min: 3460, max: Infinity, rate: 0.064 }],
        hoh:     [{ min: 0, max: 3460, rate: 0 }, { min: 3460, max: Infinity, rate: 0.064 }],
      },
    },
  },

  SD: {
    name: 'South Dakota',
    sui: { wageBase: 15000, newEmployerRate: 0.012 },
    sit: null,
  },

  TN: {
    name: 'Tennessee',
    sui: { wageBase: 7000, newEmployerRate: 0.027 },
    sit: null,
  },

  TX: {
    name: 'Texas',
    sui: { wageBase: 9000, newEmployerRate: 0.027 },
    sit: null,
  },

  UT: {
    name: 'Utah',
    sui: { wageBase: 47000, newEmployerRate: 0.01 },
    sit: { type: 'flat', rate: 0.0455 },
  },

  VT: {
    name: 'Vermont',
    sui: { wageBase: 14100, newEmployerRate: 0.01 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 7000, married: 14000, hoh: 10500 },
      brackets: {
        single: [
          { min: 0,      max: 45400,  rate: 0.0335 },
          { min: 45400,  max: 110050, rate: 0.066  },
          { min: 110050, max: 229550, rate: 0.076  },
          { min: 229550, max: Infinity, rate: 0.0875 },
        ],
        married: [
          { min: 0,      max: 75850,  rate: 0.0335 },
          { min: 75850,  max: 183400, rate: 0.066  },
          { min: 183400, max: 279900, rate: 0.076  },
          { min: 279900, max: Infinity, rate: 0.0875 },
        ],
        hoh: [
          { min: 0,      max: 45400,  rate: 0.0335 },
          { min: 45400,  max: 110050, rate: 0.066  },
          { min: 110050, max: 229550, rate: 0.076  },
          { min: 229550, max: Infinity, rate: 0.0875 },
        ],
      },
    },
  },

  VA: {
    name: 'Virginia',
    sui: { wageBase: 8000, newEmployerRate: 0.0273 },
    sit: {
      type: 'brackets',
      standardDeduction: { single: 8000, married: 16000, hoh: 8000 },
      brackets: {
        single: [
          { min: 0,     max: 3000,  rate: 0.02   },
          { min: 3000,  max: 5000,  rate: 0.03   },
          { min: 5000,  max: 17000, rate: 0.05   },
          { min: 17000, max: Infinity, rate: 0.0575 },
        ],
        married: [
          { min: 0,     max: 3000,  rate: 0.02   },
          { min: 3000,  max: 5000,  rate: 0.03   },
          { min: 5000,  max: 17000, rate: 0.05   },
          { min: 17000, max: Infinity, rate: 0.0575 },
        ],
        hoh: [
          { min: 0,     max: 3000,  rate: 0.02   },
          { min: 3000,  max: 5000,  rate: 0.03   },
          { min: 5000,  max: 17000, rate: 0.05   },
          { min: 17000, max: Infinity, rate: 0.0575 },
        ],
      },
    },
  },

  WA: {
    name: 'Washington',
    sui: { wageBase: 72800, newEmployerRate: 0.01 },
    sit: null,
  },

  WV: {
    name: 'West Virginia',
    sui: { wageBase: 9000, newEmployerRate: 0.027 },
    sit: {
      type: 'brackets',
      estimated: true,
      standardDeduction: { single: 0, married: 0, hoh: 0 },
      brackets: {
        single: [
          { min: 0,      max: 10000,  rate: 0.03   },
          { min: 10000,  max: 25000,  rate: 0.04   },
          { min: 25000,  max: 40000,  rate: 0.045  },
          { min: 40000,  max: 60000,  rate: 0.06   },
          { min: 60000,  max: Infinity, rate: 0.065 },
        ],
        married: [
          { min: 0,      max: 10000,  rate: 0.03   },
          { min: 10000,  max: 25000,  rate: 0.04   },
          { min: 25000,  max: 40000,  rate: 0.045  },
          { min: 40000,  max: 60000,  rate: 0.06   },
          { min: 60000,  max: Infinity, rate: 0.065 },
        ],
        hoh: [
          { min: 0,      max: 10000,  rate: 0.03   },
          { min: 10000,  max: 25000,  rate: 0.04   },
          { min: 25000,  max: 40000,  rate: 0.045  },
          { min: 40000,  max: 60000,  rate: 0.06   },
          { min: 60000,  max: Infinity, rate: 0.065 },
        ],
      },
    },
  },

  WI: {
    name: 'Wisconsin',
    sui: { wageBase: 14000, newEmployerRate: 0.0305 },
    sit: {
      type: 'brackets',
      standardDeduction: { single: 12560, married: 23220, hoh: 17020 },
      brackets: {
        single: [
          { min: 0,       max: 14320,  rate: 0.035  },
          { min: 14320,   max: 28640,  rate: 0.044  },
          { min: 28640,   max: 315310, rate: 0.053  },
          { min: 315310,  max: Infinity, rate: 0.0765 },
        ],
        married: [
          { min: 0,       max: 19090,  rate: 0.035  },
          { min: 19090,   max: 38190,  rate: 0.044  },
          { min: 38190,   max: 420420, rate: 0.053  },
          { min: 420420,  max: Infinity, rate: 0.0765 },
        ],
        hoh: [
          { min: 0,       max: 14320,  rate: 0.035  },
          { min: 14320,   max: 28640,  rate: 0.044  },
          { min: 28640,   max: 315310, rate: 0.053  },
          { min: 315310,  max: Infinity, rate: 0.0765 },
        ],
      },
    },
  },

  WY: {
    name: 'Wyoming',
    sui: { wageBase: 30900, newEmployerRate: 0.0118 },
    sit: null,
  },
};

module.exports = STATE_TAX_RATES;
