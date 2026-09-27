/**
 * Branch-scope isolation test runner — SAFE BY CONSTRUCTION.
 *
 * WHY THIS EXISTS
 *
 * The isolation test has to prove that a bulk "clear sales" is bounded to one
 * branch, which means it has to actually perform a bulk delete. The first version
 * of this harness ran against the development database and did exactly that:
 * it cleared every sale on the real Main branch, and those rows were not
 * recoverable. A test that can destroy working data is not a safety net.
 *
 * So the test never touches `prisma/db/dev.db`. This runner:
 *   1. copies the dev database to a temp file (structure + catalogue only matter),
 *   2. starts a SECOND dev server on its own port bound to that copy,
 *   3. seeds the QA branch fixture into the copy,
 *   4. runs the isolation suite against that server,
 *   5. kills the server and deletes the copy.
 *
 * The copy is disposable. If anything is lost, it is the copy.
 *
 * Usage: node scripts/branch-scope-test.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.BRANCH_TEST_PORT || 8123);
const SRC_DB = process.env.BRANCH_TEST_SRC_DB || path.join(ROOT, 'prisma', 'db', 'dev.db');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-scope-test-'));
const testDb = path.join(tmpDir, 'test.db');
// Prisma wants a `file:` URL; the dev DB is stored outside `prisma/`, so give it
// the explicit form rather than relying on a relative path.
const testDbUrl = `file:${testDb.replace(/\\/g, '/')}`;

let server = null;
let exitCode = 1;
/** Set by the suite's own summary line, so a silent run cannot look green. */
let sawTestOutput = false;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...(opts.env || {}) },
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Like `run`, but also watches stdout for the suite's summary line. */
function runPiped(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, ...(opts.env || {}) },
      shell: process.platform === 'win32',
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (/\d+ passed, \d+ failed/.test(chunk)) sawTestOutput = true;
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function waitForServer(timeoutMs = 120000) {
  const http = require('node:http');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const up = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: '/api/branches', method: 'GET', timeout: 3000 },
        (res) => {
          res.resume();
          resolve(true);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (up) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function cleanup() {
  if (server && !server.killed) {
    try {
      server.kill();
    } catch {
      /* already gone */
    }
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* temp dir is disposable anyway */
  }
}

async function main() {
  if (!fs.existsSync(SRC_DB)) {
    console.error(`Source database not found: ${SRC_DB}`);
    console.error('Set BRANCH_TEST_SRC_DB to a SQLite file to use as the template.');
    process.exit(1);
  }

  console.log(`[branch-scope-test] copying ${SRC_DB}`);
  console.log(`[branch-scope-test]   -> ${testDb}`);
  fs.copyFileSync(SRC_DB, testDb);

  const env = { DATABASE_URL: testDbUrl, DATABASE_PROVIDER: 'sqlite' };

  console.log(`[branch-scope-test] starting dev server on :${PORT} against the COPY`);
  server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  });
  server.unref?.();

  if (!(await waitForServer())) {
    console.error('[branch-scope-test] dev server did not become ready');
    return;
  }

  console.log('[branch-scope-test] seeding fixture into the copy\n');
  const seedCode = await run('node', ['scripts/branch-scope-fixture.cjs', 'seed'], { env });
  if (seedCode !== 0) {
    console.error('[branch-scope-test] fixture seed failed');
    return;
  }

  console.log('');
  const testCode = await runPiped('node', ['scripts/branch-scope-isolation.test.cjs'], {
    env: { BRANCH_TEST_PORT: String(PORT), DATABASE_URL: testDbUrl },
  });

  // A suite that printed no summary ran nothing — an empty run and a passing run
  // both exit 0, so a broken harness would otherwise report PASSED and hide it.
  if (!sawTestOutput) {
    console.error('[branch-scope-test] the suite produced no output — treating as FAILURE');
    return;
  }

  exitCode = testCode === 0 && sawTestOutput ? 0 : 1;
  console.log(`\n[branch-scope-test] ${exitCode === 0 ? 'PASSED' : 'FAILED'} (working database untouched)`);
}

main()
  .catch((e) => {
    console.error('[branch-scope-test] harness error:', e);
    exitCode = 1;
  })
  .finally(async () => {
    // The Next dev server spawns children; kill the tree on both platforms.
    try {
      if (process.platform === 'win32' && server?.pid) {
        spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        server?.kill('SIGKILL');
      }
    } catch {
      /* nothing more we can do */
    }
    await new Promise((r) => setTimeout(r, 1500));
    cleanup();
    process.exit(exitCode);
  });
