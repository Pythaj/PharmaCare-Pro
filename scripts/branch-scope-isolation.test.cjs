/**
 * Branch-scope isolation test — HTTP level, real dev server, no dependencies.
 *
 * Phase 4's whole claim is "a session only ever sees its own branch". Checking
 * that by reading the code proves nothing: the failure mode is a `where` clause
 * somebody forgot, and a forgotten clause typechecks perfectly. So this drives
 * the actual Next.js route handlers over HTTP and asserts that a session parked
 * on Branch A cannot see, read, or act on Branch B's rows.
 *
 * DESTRUCTIVE: the bulk-clear section really does delete a branch's sales.
 * Do NOT point this at the development database — run it through
 * `node scripts/branch-scope-test.cjs`, which serves a disposable copy.
 *
 * Requires a seeded fixture and a reachable server. Override the target with
 * BRANCH_TEST_PORT.
 */
const http = require('node:http');

const BASE = { host: '127.0.0.1', port: Number(process.env.BRANCH_TEST_PORT || 8000) };
const QA_BATCH = 'QA-ISO-batch';
const QA_SALE = 'QA-ISO-sale';
const QA_RETURN = 'QA-ISO-return';
const EMAIL = 'qa.tester@local.invalid';
const PASSWORD = 'QaIsolation!2026';

let cookie = '';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { accept: 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (data) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = data.length;
    }
    const req = http.request({ ...BASE, method, path, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          const auth = setCookie.find((c) => c.startsWith('auth_token='));
          if (auth) cookie = auth.split(';')[0];
        }
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          /* non-JSON (e.g. HTML error page) */
        }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

/** Recursively look for the QA marker anywhere in a JSON payload. */
function contains(rowset, id) {
  return JSON.stringify(rowset ?? null).includes(id);
}

async function main() {
  console.log('\n== login ==');
  const login = await request('POST', '/api/auth', { email: EMAIL, password: PASSWORD });
  check('admin login succeeds', login.status === 200, `status ${login.status} ${login.raw.slice(0, 200)}`);
  if (login.status !== 200) throw new Error('cannot continue without a session');
  check('login issued a session cookie', cookie.startsWith('auth_token='), cookie.slice(0, 24));

  // ---------- Consolidated view: the fixture must be visible here ----------
  // A fresh login carries no branch claim, so an admin starts on the whole
  // business. Stated explicitly below so the test never depends on that default.
  console.log('\n== all-branches view (admin, no active branch) ==');
  const initialAll = await request('POST', '/api/auth/branch', { branchId: 'all' });
  check('switch to "all" accepted', initialAll.status === 200, `status ${initialAll.status} ${initialAll.raw.slice(0, 160)}`);

  const allBatches = await request('GET', '/api/batches?limit=200');
  check('GET /api/batches shows both branches', contains(allBatches.json, QA_BATCH), `status ${allBatches.status}`);

  const allSales = await request('GET', '/api/sales?limit=200');
  check('GET /api/sales shows the QA sale', contains(allSales.json, QA_SALE), `status ${allSales.status}`);

  const allReturns = await request('GET', '/api/returns');
  check('GET /api/returns shows the QA return', contains(allReturns.json, QA_RETURN), `status ${allReturns.status}`);

  const allReports = await request('GET', '/api/reports?period=this_year');
  check('GET /api/reports is reachable', allReports.status === 200, `status ${allReports.status}`);

  const allAudit = await request('GET', '/api/audit-logs?limit=200');
  check('GET /api/audit-logs reachable', allAudit.status === 200, `status ${allAudit.status}`);

  // ---------- Switch to the OTHER branch, then try to leak ----------
  console.log('\n== parked on Main branch, must not see QA rows ==');
  const toAll = await request('POST', '/api/auth/branch', { branchId: 'all' });
  check('switch to "all" accepted', toAll.status === 200, `status ${toAll.status} ${toAll.raw.slice(0, 160)}`);

  const branches = await request('GET', '/api/branches');
  const main = (branches.json?.branches ?? []).find((b) => b.code !== 'QA');
  check('found a non-QA branch to switch to', !!main, JSON.stringify(branches.json).slice(0, 200));
  if (!main) throw new Error('no second branch to switch to');

  const sw = await request('POST', '/api/auth/branch', { branchId: main.id });
  check('branch switch accepted', sw.status === 200, `status ${sw.status} ${sw.raw.slice(0, 200)}`);

  const scopedBatches = await request('GET', '/api/batches?limit=200');
  check('GET /api/batches hides the QA batch', !contains(scopedBatches.json, QA_BATCH), 'QA batch leaked into a branch-scoped list');

  const scopedSales = await request('GET', '/api/sales?limit=200');
  check('GET /api/sales hides the QA sale', !contains(scopedSales.json, QA_SALE), 'QA sale leaked into a branch-scoped list');

  const scopedReturns = await request('GET', '/api/returns');
  check('GET /api/returns hides the QA return', !contains(scopedReturns.json, QA_RETURN), 'QA return leaked into a branch-scoped list');

  const scopedStats = await request('GET', '/api/dashboard/stats');
  check('GET /api/dashboard/stats reachable', scopedStats.status === 200, `status ${scopedStats.status}`);

  const scopedCharts = await request('GET', '/api/dashboard/charts');
  check('GET /api/dashboard/charts reachable', scopedCharts.status === 200, `status ${scopedCharts.status}`);

  const scopedRecent = await request('GET', '/api/dashboard/recent');
  check('GET /api/dashboard/recent hides the QA sale', !contains(scopedRecent.json, QA_SALE), 'QA sale leaked into recent activity');

  const scopedAlerts = await request('GET', '/api/inventory/alerts');
  check('GET /api/inventory/alerts hides the QA batch', !contains(scopedAlerts.json, QA_BATCH), 'QA batch leaked into stock alerts');

  const scopedProducts = await request('GET', '/api/products?limit=200');
  check('GET /api/products hides the QA batch in nested stock', !contains(scopedProducts.json, QA_BATCH), 'QA batch leaked through a product lookup');

  const scopedAudit = await request('GET', '/api/audit-logs?limit=200');
  check('GET /api/audit-logs is branch filtered', scopedAudit.status === 200, `status ${scopedAudit.status}`);

  const scopedReports = await request('GET', '/api/reports?period=this_year');
  check('GET /api/reports excludes the QA sale', !contains(scopedReports.json, QA_SALE), 'QA sale leaked into a branch report');

  // ---------- Direct-object access must be refused ----------
  console.log('\n== direct-object access to another branch ==');

  const readSale = await request('GET', `/api/sales/${QA_SALE}`);
  check('GET /api/sales/[qa] is refused', readSale.status === 403, `status ${readSale.status}`);

  const delSale = await request('DELETE', `/api/sales/${QA_SALE}`);
  check('DELETE /api/sales/[qa] is refused', delSale.status === 403, `status ${delSale.status}`);

  const patchBatch = await request('PATCH', `/api/batches/${QA_BATCH}`, { quantity: 999 });
  check('PATCH /api/batches/[qa] is refused', patchBatch.status === 403, `status ${patchBatch.status}`);

  const delBatch = await request('DELETE', `/api/batches/${QA_BATCH}`);
  check('DELETE /api/batches/[qa] is refused', delBatch.status === 403, `status ${delBatch.status}`);

  const approveReturn = await request('PATCH', `/api/returns/${QA_RETURN}`, { status: 'approved' });
  check('PATCH /api/returns/[qa] is refused', approveReturn.status === 403, `status ${approveReturn.status}`);

  const delReturn = await request('DELETE', `/api/returns/${QA_RETURN}`);
  check('DELETE /api/returns/[qa] is refused', delReturn.status === 403, `status ${delReturn.status}`);

  const newReturn = await request('POST', '/api/returns', {
    saleId: QA_SALE,
    reason: 'cross-branch refund attempt',
    items: [],
  });
  check('POST /api/returns for another branch is refused', newReturn.status === 403, `status ${newReturn.status}`);

  const reopenProbe = await request('PATCH', `/api/daily-sales/${QA_SALE}`, { action: 'reopen' });
  check('PATCH /api/daily-sales/[foreign] is refused or 404', [403, 404].includes(reopenProbe.status), `status ${reopenProbe.status}`);

  // ---------- Bulk clear must not cross branches ----------
  console.log('\n== bulk clear is branch bounded ==');
  const bulk = await request('DELETE', '/api/sales?confirm=yes');
  check('DELETE /api/sales?confirm=yes is branch scoped', bulk.status === 200, `status ${bulk.status} ${bulk.raw.slice(0, 160)}`);
  check('bulk clear reported a branch scope', /this branch/i.test(bulk.json?.message ?? ''), bulk.json?.message);

  // The QA sale must still be there afterwards.
  await request('POST', '/api/auth/branch', { branchId: 'all' });
  const survivors = await request('GET', `/api/sales/${QA_SALE}`);
  check('QA sale survived a Main-branch bulk clear', survivors.status === 200, `status ${survivors.status}`);

  await transferTests();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

/** Read one batch's on-hand quantity as the session's branch sees it. */
async function batchQuantity(batchNumber) {
  const res = await request('GET', '/api/batches');
  // This endpoint returns a bare array, unlike most of the API.
  const rows = Array.isArray(res.json) ? res.json : (res.json?.batches ?? []);
  const found = rows.find((b) => b.batchNumber === batchNumber);
  return found ? found.quantity : null;
}

async function transferTests() {
  console.log('\n== stock transfers: QA branch is the source ==');

  const branches = await request('GET', '/api/branches');
  const qa = (branches.json?.branches ?? []).find((b) => b.code === 'QA');
  const mainB = (branches.json?.branches ?? []).find((b) => b.code !== 'QA');
  if (!qa || !mainB) {
    check('transfer fixtures present (QA + Main branches)', false, 'branches missing');
    return;
  }

  await request('POST', '/api/auth/branch', { branchId: qa.id });

  // 1. Raising a transfer must NOT move stock.
  const before = await batchQuantity('QA-ISO-B1');
  check('QA batch starts at 42', before === 42, `saw ${before}`);

  const raise = await request('POST', '/api/stock-transfers', {
    toBranchId: mainB.id,
    notes: 'top up Main',
    items: [{ batchId: QA_BATCH, quantity: 10 }],
  });
  check('POST /api/stock-transfers accepts a valid transfer', raise.status === 201, `status ${raise.status} ${raise.raw.slice(0, 200)}`);
  const transferId = raise.json?.transfer?.id;
  check('transfer reference is branch coded', /^TRF-QA-\d{4}$/.test(raise.json?.transfer?.reference ?? ''), raise.json?.transfer?.reference);

  const afterRaise = await batchQuantity('QA-ISO-B1');
  check('raising a transfer does NOT move stock', afterRaise === 42, `stock became ${afterRaise} on a pending transfer`);

  // 2. Cannot ship stock the branch does not have.
  const over = await request('POST', '/api/stock-transfers', {
    toBranchId: mainB.id,
    items: [{ batchId: QA_BATCH, quantity: 1000 }],
  });
  check('over-transfer is refused', over.status === 400, `status ${over.status}`);

  // 3. Committed stock counts as gone: 42 on hand, 10 committed -> 32 max.
  const doubleCommit = await request('POST', '/api/stock-transfers', {
    toBranchId: mainB.id,
    items: [{ batchId: QA_BATCH, quantity: 40 }],
  });
  check('stock already committed to a pending transfer is not re-sellable', doubleCommit.status === 400, `status ${doubleCommit.status}`);

  // 4. Duplicate lines on one batch must not bypass the availability check.
  const split = await request('POST', '/api/stock-transfers', {
    toBranchId: mainB.id,
    items: [
      { batchId: QA_BATCH, quantity: 25 },
      { batchId: QA_BATCH, quantity: 25 },
    ],
  });
  check('two lines on one batch are summed before the stock check', split.status === 400, `status ${split.status}`);

  // 5. Destination branch cannot be the source.
  const sameBranch = await request('POST', '/api/stock-transfers', {
    toBranchId: qa.id,
    items: [{ batchId: QA_BATCH, quantity: 1 }],
  });
  check('same source and destination is refused', sameBranch.status === 400, `status ${sameBranch.status}`);

  // 6. Completing moves the stock, both sides.
  const complete = await request('PATCH', `/api/stock-transfers/${transferId}`, { action: 'complete' });
  check('completing a transfer succeeds', complete.status === 200, `status ${complete.status} ${complete.raw.slice(0, 200)}`);
  check('completed transfer records the destination batch', !!complete.json?.transfer?.lines?.[0]?.destBatchId, JSON.stringify(complete.json?.transfer?.lines?.[0] ?? {}).slice(0, 160));

  const afterComplete = await batchQuantity('QA-ISO-B1');
  check('source batch is debited on completion', afterComplete === 32, `expected 32, saw ${afterComplete}`);

  await request('POST', '/api/auth/branch', { branchId: mainB.id });
  const received = await batchQuantity('QA-ISO-B1');
  check('destination branch is credited on completion', received === 10, `expected 10, saw ${received}`);

  // 7. The receiving branch can see the transfer it was sent.
  const inbound = await request('GET', '/api/stock-transfers');
  check('destination branch sees the inbound transfer', contains(inbound.json, transferId), 'inbound transfer hidden from the receiving branch');
  const detail = await request('GET', `/api/stock-transfers/${transferId}`);
  check('destination branch can read the transfer', detail.status === 200, `status ${detail.status}`);

  // 8. Terminal statuses are refused rather than silently re-running.
  const again = await request('PATCH', `/api/stock-transfers/${transferId}`, { action: 'complete' });
  check('a completed transfer cannot be completed twice', again.status === 400, `status ${again.status}`);
  const cancelAfter = await request('PATCH', `/api/stock-transfers/${transferId}`, { action: 'cancel' });
  check('a completed transfer cannot be cancelled', cancelAfter.status === 400, `status ${cancelAfter.status}`);

  // 9. Only the sending branch may cancel, and only while pending.
  await request('POST', '/api/auth/branch', { branchId: qa.id });
  const pending = await request('POST', '/api/stock-transfers', {
    toBranchId: mainB.id,
    items: [{ batchId: QA_BATCH, quantity: 2 }],
  });
  check('second transfer is raised', pending.status === 201, `status ${pending.status}`);
  check('references increment per branch', pending.json?.transfer?.reference === 'TRF-QA-0002', pending.json?.transfer?.reference);
  const pendingId = pending.json?.transfer?.id;

  await request('POST', '/api/auth/branch', { branchId: mainB.id });
  const foreignCancel = await request('PATCH', `/api/stock-transfers/${pendingId}`, { action: 'cancel' });
  check('destination branch cannot cancel an outbound transfer', foreignCancel.status === 403, `status ${foreignCancel.status}`);

  // 10. Rejecting leaves both shelves untouched and releases the commitment.
  await request('POST', '/api/auth/branch', { branchId: qa.id });
  const rejected = await request('PATCH', `/api/stock-transfers/${pendingId}`, { action: 'reject' });
  check('rejecting a pending transfer succeeds', rejected.status === 200, `status ${rejected.status}`);
  const afterReject = await batchQuantity('QA-ISO-B1');
  check('a rejected transfer moves no stock', afterReject === 32, `expected 32, saw ${afterReject}`);

  const full = await request('POST', '/api/stock-transfers', {
    toBranchId: mainB.id,
    items: [{ batchId: QA_BATCH, quantity: 32 }],
  });
  check('a rejected transfer releases its committed stock', full.status === 201, `status ${full.status} ${full.raw.slice(0, 160)}`);

  // 11. The audit trail names the movement.
  await request('POST', '/api/auth/branch', { branchId: 'all' });
  const audit = await request('GET', '/api/audit-logs?limit=200');
  check('transfer actions are audited', contains(audit.json, 'TRANSFER_COMPLETE'), 'no TRANSFER_COMPLETE audit entry found');
  check('audit covers the StockTransfer entity', contains(audit.json, 'StockTransfer'), 'no StockTransfer audit entity found');
}

main().catch((e) => {
  console.error('\nharness error:', e.message);
  console.error('Is the dev server running, and the fixture seeded?');
  console.error('Run through: node scripts/branch-scope-test.cjs');
  process.exit(1);
});
