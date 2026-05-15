#!/usr/bin/env node
'use strict';

const { spawn, execSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const http   = require('http');
const https  = require('https');
const url    = require('url');

const IS_WIN    = process.platform === 'win32';
const STATE_DIR = path.join(os.homedir(), '.headroom-gui');
const PID_FILE  = path.join(STATE_DIR, 'server.pid');
const PORT_FILE = path.join(STATE_DIR, 'server.port');
const URL_FILE  = path.join(STATE_DIR, 'server.url');
const LOG_FILE  = path.join(STATE_DIR, 'server.log');
const INDEX     = path.join(__dirname, '..', 'index.html');

fs.mkdirSync(STATE_DIR, { recursive: true });

// ── arg parsing ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

const cmd        = argv[0];
const guiPort    = parseInt(flag('--port'))        || parseInt(process.env.HEADROOM_GUI_PORT) || 3000;
const proxyPort  = parseInt(flag('--proxy-port'))  || parseInt(process.env.HEADROOM_PROXY_PORT) || 8787;
const proxyHost  = flag('--proxy-host')            || process.env.HEADROOM_PROXY_HOST || '127.0.0.1';
const headroomUrl = `http://${proxyHost}:${proxyPort}`;

// ── command dispatch ─────────────────────────────────────────────────────────
switch (cmd) {
  case 'start':  cmdStart();          break;
  case 'stop':   cmdStop();           break;
  case 'status': cmdStatus();         break;
  case '_serve': cmdServe();          break;
  default:
    console.log([
      '',
      '  headroom-gui <command> [options]',
      '',
      '  Commands:',
      '    start   [options]   Start GUI in background',
      '    stop                Stop background server',
      '    status              Show running state',
      '',
      '  Options:',
      '    --port <n>          GUI server port        (default: 3000)',
      '    --proxy-port <n>    Headroom API port      (default: 8787)',
      '    --proxy-host <h>    Headroom API host      (default: 127.0.0.1)',
      '',
      '  Env overrides:',
      '    HEADROOM_GUI_PORT       GUI port',
      '    HEADROOM_PROXY_PORT     Headroom port',
      '    HEADROOM_PROXY_HOST     Headroom host',
      '',
    ].join('\n'));
    process.exit(1);
}

// ── internal server (spawned as detached child) ──────────────────────────────
function cmdServe() {
  const p           = parseInt(process.env.GUI_PORT)    || 3000;
  const hUrl        = process.env.HEADROOM_URL          || 'http://127.0.0.1:8787';
  const parsed      = url.parse(hUrl);
  const proxySecure = parsed.protocol === 'https:';
  const proxyHost_  = parsed.hostname;
  const proxyPort_  = parseInt(parsed.port) || (proxySecure ? 443 : 80);

  const server = http.createServer((req, res) => {
    const reqUrl = req.url.split('?')[0];

    if (reqUrl === '/' || reqUrl === '/index.html') {
      try {
        const html = fs.readFileSync(INDEX);
        res.writeHead(200, {
          'Content-Type':  'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(html);
      } catch (e) {
        res.writeHead(500);
        res.end('index.html not found: ' + e.message);
      }
      return;
    }

    if (req.url.startsWith('/api')) {
      proxyToHeadroom(req, res, proxyHost_, proxyPort_, proxySecure, req.url.slice(4) || '/');
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.on('error', e => {
    fs.appendFileSync(LOG_FILE, 'Error: ' + e.message + '\n');
    process.exit(1);
  });

  server.listen(p, '127.0.0.1', () => {
    fs.appendFileSync(LOG_FILE, 'Listening on http://127.0.0.1:' + p + '\n');
  });
}

function proxyToHeadroom(clientReq, clientRes, host, port, secure, targetPath) {
  // targetPath already includes query string (sliced from req.url)
  const options = {
    host,
    port,
    path: targetPath || '/',
    method: clientReq.method,
    headers: Object.assign({}, clientReq.headers, { host }),
  };
  delete options.headers['origin'];
  delete options.headers['referer'];

  const transport = secure ? https : http;
  const proxy = transport.request(options, upRes => {
    clientRes.writeHead(upRes.statusCode, Object.assign({
      'Access-Control-Allow-Origin': '*',
    }, upRes.headers));
    upRes.pipe(clientRes);
  });

  proxy.on('error', e => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
      clientRes.end('Headroom unreachable: ' + e.message);
    }
  });

  clientReq.pipe(proxy);
}

// ── start ────────────────────────────────────────────────────────────────────
function cmdStart() {
  checkHeadroom(headroomUrl, (reachable) => {
    if (!reachable) {
      console.error([
        '',
        '  Headroom is not running at ' + headroomUrl,
        '',
        '  Start it first:',
        '    headroom proxy',
        '',
        '  Running on a different port?',
        '    headroom-gui start --proxy-port <port>',
        '',
      ].join('\n'));
      process.exit(1);
    }

    if (fs.existsSync(PID_FILE)) {
      const pid = readPid();
      if (pid && isRunning(pid)) {
        const p = readPort();
        console.log('\n  Already running   PID ' + pid + '   http://localhost:' + p + '\n');
        return;
      }
      cleanup();
    }

    fs.writeFileSync(LOG_FILE, '');
    const logFd = fs.openSync(LOG_FILE, 'a');

    const child = spawn(process.execPath, [__filename, '_serve'], {
      detached:    true,
      stdio:       ['ignore', logFd, logFd],
      windowsHide: true,
      env: Object.assign({}, process.env, {
        GUI_PORT:     String(guiPort),
        HEADROOM_URL: headroomUrl,
      }),
    });
    child.unref();
    fs.closeSync(logFd);

    fs.writeFileSync(PID_FILE,  String(child.pid));
    fs.writeFileSync(PORT_FILE, String(guiPort));
    fs.writeFileSync(URL_FILE,  headroomUrl);

    setTimeout(() => {
      if (!isRunning(child.pid)) {
        const log = (() => { try { return fs.readFileSync(LOG_FILE, 'utf8').trim(); } catch(e) { return ''; } })();
        console.error('\n  Failed to start.');
        if (log) console.error('  ' + log.split('\n').join('\n  '));
        console.error('  Log: ' + LOG_FILE + '\n');
        cleanup();
        process.exit(1);
      }
      console.log([
        '',
        '  Headroom Monitor',
        '  http://localhost:' + guiPort,
        '  PID    : ' + child.pid,
        '  API    : ' + headroomUrl,
        '  Log    : ' + LOG_FILE,
        '  Stop   : headroom-gui stop',
        '',
      ].join('\n'));
    }, 1200);
  });
}

// ── stop ─────────────────────────────────────────────────────────────────────
function cmdStop() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('Not running.');
    return;
  }
  const pid = readPid();
  if (!pid) { cleanup(); console.log('Not running.'); return; }

  let killed = false;
  if (IS_WIN) {
    try { execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore' }); killed = true; } catch(e) {}
  }
  if (!killed) {
    try { process.kill(pid, 'SIGTERM'); killed = true; } catch(e) {}
  }

  cleanup();
  console.log('Stopped' + (killed ? ' (PID ' + pid + ')' : ' (already gone)'));
}

// ── status ───────────────────────────────────────────────────────────────────
function cmdStatus() {
  if (!fs.existsSync(PID_FILE)) { console.log('Not running.'); return; }
  const pid  = readPid();
  const p    = readPort();
  const hUrl = readUrl();
  if (pid && isRunning(pid)) {
    console.log([
      '',
      '  Running',
      '  GUI    : http://localhost:' + p + '   (PID ' + pid + ')',
      '  API    : ' + hUrl,
      '',
    ].join('\n'));
  } else {
    console.log('Not running (stale state). Run: headroom-gui stop');
    cleanup();
  }
}

// ── utils ────────────────────────────────────────────────────────────────────
function readPid()  { try { return parseInt(fs.readFileSync(PID_FILE,  'utf8').trim()); } catch(e) { return null; } }
function readPort() { try { return parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim()); } catch(e) { return 3000; } }
function readUrl()  { try { return fs.readFileSync(URL_FILE, 'utf8').trim(); } catch(e) { return 'http://127.0.0.1:8787'; } }

function cleanup() {
  [PID_FILE, PORT_FILE, URL_FILE].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
}

function isRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch(e) { return e.code === 'EPERM'; }
}

function checkHeadroom(base, cb) {
  const parsed  = url.parse(base + '/livez');
  const options = { host: parsed.hostname, port: parsed.port, path: '/livez', method: 'GET' };
  const req = http.request(options, res => {
    res.resume();
    cb(res.statusCode < 500);
  });
  req.setTimeout(3000, () => { req.destroy(); cb(false); });
  req.on('error', () => cb(false));
  req.end();
}
