#!/usr/bin/env node
/**
 * set-pin.js — Update a company's EFTPS Batch Provider PIN via the bridge.
 *
 * Usage (run from the bridge-server folder while the bridge is running):
 *   node set-pin.js <EIN> <PIN>
 *
 * Examples:
 *   node set-pin.js 475652843 1234
 *   node set-pin.js 47-5652843 1234
 */
'use strict';

const http = require('http');

const [,, ein, pin] = process.argv;

if (!ein || !pin) {
  console.error('Usage: node set-pin.js <EIN> <4-digit-PIN>');
  console.error('Example: node set-pin.js 475652843 1234');
  process.exit(1);
}

const cleanEin = ein.replace(/-/g, '');
if (!/^\d{9}$/.test(cleanEin)) {
  console.error('Error: EIN must be 9 digits (dashes optional). Got:', ein);
  process.exit(1);
}
if (!/^\d{4}$/.test(pin)) {
  console.error('Error: PIN must be exactly 4 digits. Got:', pin);
  process.exit(1);
}

const body = JSON.stringify({ ein: cleanEin, pin });

const req = http.request(
  {
    host: 'localhost',
    port: 4000,
    path: '/api/update-pin',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const r = JSON.parse(data);
        if (r.ok) {
          console.log('✓', r.message);
        } else {
          console.error('✗', r.error);
          process.exit(1);
        }
      } catch {
        console.error('✗ Unexpected response:', data);
        process.exit(1);
      }
    });
  }
);

req.on('error', (e) => {
  if (e.code === 'ECONNREFUSED') {
    console.error('✗ Could not connect to bridge dashboard (localhost:4000).');
    console.error('  Make sure the bridge is running first: npm start');
  } else {
    console.error('✗ Request error:', e.message);
  }
  process.exit(1);
});

req.write(body);
req.end();
