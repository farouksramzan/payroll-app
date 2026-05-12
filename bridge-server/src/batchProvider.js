/**
 * EFTPS Batch Provider Interface
 *
 * Two submission modes, controlled by BATCH_PROVIDER_MODE env var:
 *
 * MODE: 'folder'  (default)
 *   Drop the ACH file into WATCHED_FOLDER_PATH.
 *   Wait for EFTPS Batch Provider to pick it up and write a response file
 *   to RESPONSE_FOLDER_PATH. Parse the response for the EFT confirmation number.
 *   This is the most reliable mode — no knowledge of the CLI required.
 *
 * MODE: 'cli'
 *   Call the Batch Provider executable directly with the ACH file path.
 *   BATCH_PROVIDER_PATH must point to the executable.
 *   BATCH_PROVIDER_ARGS is prepended to the file path (e.g. "/import").
 *   Parses stdout/stderr for the confirmation number.
 *
 * In both modes, the ACH file is saved to WATCHED_FOLDER_PATH first.
 */

'use strict';

const fs         = require('fs');
const path       = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const WATCHED_FOLDER   = process.env.WATCHED_FOLDER_PATH  || path.join(__dirname, '../../data/ach-out');
const RESPONSE_FOLDER  = process.env.RESPONSE_FOLDER_PATH || path.join(__dirname, '../../data/ach-response');
const BATCH_PROVIDER   = process.env.BATCH_PROVIDER_PATH  || '';
const BATCH_ARGS_RAW   = process.env.BATCH_PROVIDER_ARGS  || '/import';
const MODE             = process.env.BATCH_PROVIDER_MODE  || 'folder';
const RESPONSE_TIMEOUT = parseInt(process.env.BATCH_RESPONSE_TIMEOUT_MS || '120000'); // 2 min

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Build a timestamped ACH filename.
 * EFTPS Batch Provider commonly expects: EFTPSYYMMDDHHMMSS.ach
 */
function achFilename(submissionId) {
  const now = new Date();
  const ts = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `EFTPS${ts}_${submissionId}.ach`;
}

/**
 * Save the ACH file to the watched folder.
 * Returns the full file path.
 */
function saveACHFile(achContent, submissionId) {
  ensureDir(WATCHED_FOLDER);
  const filename = achFilename(submissionId);
  const filepath = path.join(WATCHED_FOLDER, filename);
  fs.writeFileSync(filepath, achContent, { encoding: 'ascii' });
  return filepath;
}

/**
 * Watch RESPONSE_FOLDER for a new file that appears after the Batch Provider
 * processes the submission. Returns the parsed confirmation number.
 *
 * EFTPS Batch Provider writes response files in formats like:
 *   - Plain text with "Confirmation: XXXXXXXXXXXXXXX"
 *   - Or a fixed-format ACH return file
 *   - Or an XML acknowledgment
 *
 * This parser tries several patterns and falls back to returning the raw content.
 */
function waitForResponseFile(achFilePath, submissionId) {
  ensureDir(RESPONSE_FOLDER);
  const baseName = path.basename(achFilePath, '.ach');

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + RESPONSE_TIMEOUT;

    const watcher = fs.watch(RESPONSE_FOLDER, { persistent: false }, (event, filename) => {
      if (!filename) return;
      // Match response files by base name or submission ID
      if (!filename.includes(baseName) && !filename.includes(String(submissionId))) return;

      const responsePath = path.join(RESPONSE_FOLDER, filename);
      try {
        const content = fs.readFileSync(responsePath, 'utf8');
        watcher.close();
        clearInterval(pollTimer);
        resolve(parseConfirmation(content, filename));
      } catch (e) { /* file not ready yet */ }
    });

    // Fallback poll (fs.watch can miss events on some systems)
    const pollTimer = setInterval(() => {
      if (Date.now() > deadline) {
        watcher.close();
        clearInterval(pollTimer);
        reject(new Error(`Batch Provider response not received within ${RESPONSE_TIMEOUT / 1000}s. Check the response folder: ${RESPONSE_FOLDER}`));
        return;
      }
      const files = fs.readdirSync(RESPONSE_FOLDER).filter((f) =>
        f.includes(baseName) || f.includes(String(submissionId))
      );
      if (files.length > 0) {
        watcher.close();
        clearInterval(pollTimer);
        try {
          const content = fs.readFileSync(path.join(RESPONSE_FOLDER, files[0]), 'utf8');
          resolve(parseConfirmation(content, files[0]));
        } catch (e) {
          reject(e);
        }
      }
    }, 2000);
  });
}

/**
 * Parse a Batch Provider response file for the EFT acknowledgment / confirmation number.
 * Tries common patterns from different Batch Provider versions.
 */
function parseConfirmation(content, filename) {
  const patterns = [
    /EFT\s+(?:Acknowledgment|Number|Confirmation)[:\s#]+(\w{10,})/i,
    /Confirmation[:\s#]+(\w{10,})/i,
    /ACK[:\s#]+(\w{10,})/i,
    /Reference[:\s#]+(\w{10,})/i,
    /\b(\d{15})\b/,   // 15-digit EFT acknowledgment number
    /\b(\d{10,})\b/,  // any long numeric sequence
  ];
  for (const pat of patterns) {
    const m = content.match(pat);
    if (m) return { confirmation: m[1], rawResponse: content.slice(0, 500) };
  }
  // No pattern matched — return filename as fallback so it's not a hard failure
  return {
    confirmation: `FILE:${filename}`,
    rawResponse: content.slice(0, 500),
    warning: 'Could not parse confirmation number from response file. Check rawResponse.',
  };
}

/**
 * Submit via CLI mode — call the Batch Provider executable directly.
 */
async function submitViaCLI(achFilePath) {
  if (!BATCH_PROVIDER) {
    throw new Error('BATCH_PROVIDER_PATH is not set. Set it to the full path of the EFTPS Batch Provider executable.');
  }
  if (!fs.existsSync(BATCH_PROVIDER)) {
    throw new Error(`Batch Provider not found at: ${BATCH_PROVIDER}`);
  }

  const args = BATCH_ARGS_RAW.trim().split(/\s+/).concat([achFilePath]);
  const timeout = RESPONSE_TIMEOUT;

  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(BATCH_PROVIDER, args, {
      timeout,
      windowsHide: false,
      encoding: 'utf8',
    }));
  } catch (err) {
    throw new Error(`Batch Provider exited with error: ${err.message}\nstdout: ${err.stdout}\nstderr: ${err.stderr}`);
  }

  const combined = (stdout || '') + (stderr || '');
  const parsed   = parseConfirmation(combined, path.basename(achFilePath));
  return { ...parsed, stdout, stderr };
}

/**
 * Main entry point — save the ACH file and submit it via the configured mode.
 *
 * @param {string} achContent       The full ACH file string
 * @param {number} submissionId     Used for file naming and log correlation
 * @returns {Promise<{confirmation, achFilePath, rawResponse?, warning?, stdout?, stderr?}>}
 */
async function submitACH(achContent, submissionId) {
  const achFilePath = saveACHFile(achContent, submissionId);

  if (MODE === 'cli') {
    const result = await submitViaCLI(achFilePath);
    return { ...result, achFilePath };
  }

  // Default: folder drop mode — just save the file and wait for response
  const result = await waitForResponseFile(achFilePath, submissionId);
  return { ...result, achFilePath };
}

module.exports = { submitACH, saveACHFile, WATCHED_FOLDER, RESPONSE_FOLDER };
