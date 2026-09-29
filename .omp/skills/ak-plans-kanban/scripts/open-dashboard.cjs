#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const os = require('os');

const DEFAULT_PORT = 8766;
const PROBE_TIMEOUT_MS = 1000;
const START_TIMEOUT_MS = 10000;

function parseArgs(argv) {
  const args = { stop: false, open: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stop') {
      args.stop = true;
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg === '--open') {
      args.open = true;
    } else if (arg === '--dir' || arg === '--plans' || arg === '--port' || arg === '--host') {
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
      warn(`ignoring deprecated ${arg}${value ? ` ${value}` : ''}; AgentKit dashboard owns plan scope`);
    } else if (arg === '--background' || arg === '--foreground') {
      warn(`ignoring deprecated ${arg}; dashboard process is managed by ak config`);
    } else if (!arg.startsWith('--')) {
      warn(`ignoring deprecated positional path ${arg}; opening /plans`);
    } else {
      warn(`unknown flag ${arg}; opening /plans`);
    }
  }
  return args;
}

function warn(message) {
  console.error(`[plans-kanban] ${message}`);
}

function akBin() {
  return process.env.AGENTKIT_CLI || 'ak';
}

function runAK(args) {
  return spawnSync(akBin(), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function akAvailable() {
  return !runAK(['--version']).error;
}

function parseJSONEnvelope(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Try the next line; human output can precede JSON in dev builds.
    }
  }
  return null;
}

function statusURL() {
  const result = runAK(['config', 'status', '--json']);
  if (result.error) {
    return null;
  }
  const envelope = parseJSONEnvelope(result.stdout);
  const data = envelope && envelope.data ? envelope.data : envelope;
  if (!data || !data.running || !data.url) {
    return null;
  }
  return String(data.url).replace(/\/$/, '');
}

function startDashboard() {
  const child = spawn(akBin(), [
    'config',
    'start',
    '--port',
    String(DEFAULT_PORT),
    '--no-open',
    '--no-interactive'
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function requestJSON(baseURL, path) {
  return new Promise((resolve) => {
    const req = http.get(`${baseURL}${path}`, { timeout: PROBE_TIMEOUT_MS }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          json = null;
        }
        resolve({ statusCode: res.statusCode || 0, json });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, json: null });
    });
    req.on('error', () => resolve({ statusCode: 0, json: null }));
  });
}

async function supportsPlans(baseURL) {
  const health = await requestJSON(baseURL, '/api/health');
  const features = health.json && Array.isArray(health.json.features) ? health.json.features : [];
  if (features.includes('plans-dashboard')) {
    return true;
  }

  const plans = await requestJSON(baseURL, '/api/plans');
  return plans.statusCode >= 200 && plans.statusCode < 300;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDashboard() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const fromStatus = statusURL();
    const candidates = fromStatus
      ? [fromStatus]
      : [`http://127.0.0.1:${DEFAULT_PORT}`, `http://localhost:${DEFAULT_PORT}`];

    for (const baseURL of candidates) {
      if (await supportsPlans(baseURL)) {
        return baseURL;
      }
    }
    await sleep(250);
  }
  return null;
}

function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.stop) {
    const result = runAK(['config', 'stop']);
    if (result.error) {
      console.error(`[plans-kanban] ak not found; install AgentKit CLI or set AGENTKIT_CLI`);
      process.exit(1);
    }
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exit(result.status || 0);
  }

  let baseURL = await waitForDashboard();
  if (!baseURL) {
    if (!akAvailable()) {
      console.error('[plans-kanban] ak not found; install AgentKit CLI or set AGENTKIT_CLI');
      process.exit(1);
    }
    startDashboard();
    baseURL = await waitForDashboard();
  }

  if (!baseURL) {
    console.error('[plans-kanban] dashboard did not expose /api/plans. Upgrade AgentKit CLI or run `ak config start --no-open` manually.');
    process.exit(1);
  }

  const url = `${baseURL}/plans`;
  if (args.open) {
    try {
      openBrowser(url);
    } catch (err) {
      warn(`browser open failed: ${err.message}`);
    }
  }

  console.log(JSON.stringify({
    success: true,
    url,
    opened: args.open,
    platform: os.platform()
  }));
}

main().catch((err) => {
  console.error(`[plans-kanban] ${err && err.message ? err.message : err}`);
  process.exit(1);
});
