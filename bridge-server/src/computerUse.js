'use strict';

/**
 * Anthropic Computer Use API integration for EFTPS Batch Provider automation.
 *
 * Takes a screenshot, sends it to Claude Sonnet with the computer_20250124 tool,
 * executes each returned action via PowerShell, feeds the new screenshot back,
 * and loops until Claude signals IMPORT_COMPLETE or the iteration limit is hit.
 */

const Anthropic                      = require('@anthropic-ai/sdk');
const screenshot                     = require('screenshot-desktop');
const { execFile, execFileSync }     = require('child_process');
const path                           = require('path');

const CLICK_EXECUTOR = path.join(__dirname, '..', 'click_executor.py');
const PY_OPTS        = { windowsHide: true };

const MAX_ITERATIONS = 50;
const MODEL          = 'claude-sonnet-4-6';
const POST_ACTION_MS = 600;  // wait after each action before re-screenshotting

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const py = (...args) => execFileSync('python', [CLICK_EXECUTOR, ...args.map(String)], PY_OPTS);

// ── Screen dimensions ─────────────────────────────────────────────────────────

async function getScreenDimensions() {
  return new Promise((resolve) => {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output "$($s.Width) $($s.Height)"`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 }, (err, stdout) => {
      if (!err && stdout.trim()) {
        const [w, h] = stdout.trim().split(/\s+/).map(Number);
        if (w > 0 && h > 0) return resolve({ width: w, height: h });
      }
      resolve({ width: 1920, height: 1080 });
    });
  });
}

// ── Screenshot ────────────────────────────────────────────────────────────────

// PNG spec: bytes 16-19 = width, 20-23 = height (big-endian uint32)
function pngDimensions(buf) {
  return {
    width:  buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

async function takeScreenshot() {
  const buf = await screenshot({ format: 'png' });
  const { width, height } = pngDimensions(buf);
  return { data: buf.toString('base64'), width, height };
}

// ── Action executors (all via click_executor.py / pyautogui) ─────────────────

const KEY_MAP = {
  'Return':    'enter',
  'Tab':       'tab',
  'Escape':    'escape',
  'BackSpace': 'backspace',
  'Delete':    'delete',
  'ctrl+a':    'ctrl+a',
  'ctrl+c':    'ctrl+c',
  'ctrl+v':    'ctrl+v',
  'ctrl+x':    'ctrl+x',
};

async function execMouseClick(x, y, button, clicks) {
  const btn = button === 'right' ? 'right' : 'left';
  for (let i = 0; i < clicks; i++) {
    py(x, y, btn);
    await sleep(80);
  }
  await sleep(500);
}

async function execMouseMove(x, y) {
  py('move', x, y);
}

async function execMouseDrag(sx, sy, ex, ey) {
  py('drag', sx, sy, ex, ey);
}

async function execScroll(x, y, direction, amount) {
  const notches = amount || 3;
  py('scroll', x, y, direction === 'up' ? notches : -notches);
}

async function execType(text) {
  py('type', text);
}

async function execKey(key) {
  py('key', KEY_MAP[key] || key.toLowerCase());
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

async function executeAction(action, log) {
  log('[CU] Raw action: ' + JSON.stringify(action));
  const actionType = action.action;
  log(`  → ${actionType} ${JSON.stringify(action.coordinate || action.text || action.key || '').slice(0, 60)}`);

  switch (actionType) {
    case 'mouse_move':
      await execMouseMove(action.coordinate[0], action.coordinate[1]);
      break;
    case 'left_click':
      await execMouseClick(action.coordinate[0], action.coordinate[1], 'left', 1);
      // Extra delay after Import button so Java has time to show the dialog
      if (action.coordinate[0] === 374 && action.coordinate[1] === 968) await sleep(2000);
      break;
    case 'right_click':
      await execMouseClick(action.coordinate[0], action.coordinate[1], 'right', 1);
      break;
    case 'double_click':
      await execMouseClick(action.coordinate[0], action.coordinate[1], 'left', 2);
      break;
    case 'left_click_drag':
      await execMouseDrag(action.start_coordinate[0], action.start_coordinate[1], action.coordinate[0], action.coordinate[1]);
      break;
    case 'scroll':
      await execScroll(action.coordinate[0], action.coordinate[1], action.direction, action.amount);
      break;
    case 'type':
      await execType(action.text);
      break;
    case 'key':
      await execKey(action.key);
      break;
    case 'screenshot':
    case 'wait':
      // no-op — screenshot taken automatically after every action; wait handled by POST_ACTION_MS
      break;
    default:
      log(`  ! Unknown action: ${actionType}`);
  }

  await new Promise((r) => setTimeout(r, POST_ACTION_MS));
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Automate EFTPS Batch Provider import using Claude's Computer Use API.
 *
 * @param {string}   achFilePath  Full path to the .ach file to import
 * @param {Function} log          Logging callback (msg: string) => void
 * @returns {Promise<{success:true, confirmation:string, message:string}>}
 * @throws  {Error} on failure or iteration exhaustion
 */
async function runComputerUse(achFilePath, log) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');

  const client = new Anthropic({ apiKey });
  const TOOL_WIDTH  = 1920;
  const TOOL_HEIGHT = 1080;

  const systemPrompt =
    `You are automating EFTPS Batch Provider on Windows. Follow these steps exactly in order:\n\n` +
    `1. Click the Import button at screen coordinates x=374, y=968.\n` +
    `2. A 'File Format Selector' dialog will appear. Click the 'Add' button inside it.\n` +
    `3. A file browser opens showing ACH files. Click the MOST RECENT file at the bottom of the list to select it (the file will be named something like EFTPS_${achFilePath.split(/[\\/]/).pop()}).\n` +
    `4. Click the 'Open' button to confirm the selection.\n` +
    `5. You are back in the File Format Selector dialog. Click 'OK'.\n` +
    `6. A payment row now appears in the payments list. Click it to highlight it blue.\n` +
    `7. Click the 'Submit' button at the bottom right of the window.\n` +
    `8. When the submission is complete, respond with text containing exactly "IMPORT_COMPLETE".\n` +
    `If anything fails at any step, respond with "IMPORT_FAILED:" followed by the reason.\n` +
    `Always take a screenshot before each click to confirm you can see the target element.`;

  const messages = [];

  // Initial screenshot + instruction
  const initShot = await takeScreenshot();
  log(`[CU] Screenshot: ${initShot.width}x${initShot.height} | Tool declared: ${TOOL_WIDTH}x${TOOL_HEIGHT}`);
  messages.push({
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: initShot.data } },
      { type: 'text',  text: `EFTPS Batch Provider is open. Import this file: ${achFilePath}` },
    ],
  });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    log(`[CU] Iteration ${i + 1}/${MAX_ITERATIONS}`);

    const response = await client.beta.messages.create({
      model:      MODEL,
      max_tokens: 1024,
      system:     systemPrompt,
      tools: [{
        type:              'computer_20251124',
        name:              'computer',
        display_width_px:  TOOL_WIDTH,
        display_height_px: TOOL_HEIGHT,
        display_number:    1,
      }],
      messages,
      betas: ['computer-use-2025-11-24'],
    });

    messages.push({ role: 'assistant', content: response.content });

    // Check for terminal text response
    const textBlock = response.content.find((b) => b.type === 'text');
    if (textBlock) {
      log(`[CU] Claude: ${textBlock.text.slice(0, 200)}`);
      if (textBlock.text.includes('IMPORT_COMPLETE')) {
        return { success: true, confirmation: 'EFTPS_COMPUTER_USE_OK', message: textBlock.text };
      }
      if (textBlock.text.includes('IMPORT_FAILED')) {
        throw new Error(`Batch Provider import failed: ${textBlock.text}`);
      }
    }

    if (response.stop_reason === 'end_turn') {
      // Claude stopped without explicit signal — treat as success if no error text
      const msg = textBlock?.text || '(no text)';
      log(`[CU] end_turn without signal — treating as success`);
      return { success: true, confirmation: 'EFTPS_COMPUTER_USE_OK', message: msg };
    }

    // Execute tool_use blocks and collect tool results
    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    const toolResults = [];
    for (const tu of toolUses) {
      if (tu.name === 'computer') {
        await executeAction(tu.input, log);
        const shot = await takeScreenshot();
        log(`[CU] Screenshot: ${shot.width}x${shot.height}`);
        toolResults.push({
          type:        'tool_result',
          tool_use_id: tu.id,
          content: [{
            type:   'image',
            source: { type: 'base64', media_type: 'image/png', data: shot.data },
          }],
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error(`[CU] Max iterations (${MAX_ITERATIONS}) reached without completion`);
}

module.exports = { runComputerUse };
