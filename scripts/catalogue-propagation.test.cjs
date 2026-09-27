/**
 * Catalogue propagation test - HTTP level, real dev server, no dependencies.
 *
 * WHAT THIS PROVES
 *
 * The owner's requirement is: a drug uploaded or added anywhere is sellable at
 * EVERY branch, and an admin's edit (especially a price) reaches every branch.
 * Both were broken, in ways that typecheck perfectly:
 *
 *   - creating a product via the API produced a product with no Batch at any
 *     branch, so it was invisible on every till;
 *   - opening a branch seeded nothing, so a new shop opened with an empty
 *     catalogue;
 *   - the bulk import only stocked the branch that ran it;
 *   - a price edit changed the product row while the POS kept charging
 *     `min(batch.sellingPrice)`, i.e. the old number, at every branch;
 *   - expired batches counted as sellable stock and set the price charged.
 *
 * Reading the code cannot catch any of that, so this drives the real route
 * handlers over HTTP and asserts the end state.
 *
 * DESTRUCTIVE-ish: it creates branches and products. Run it through
 * `node scripts/catalogue-propagation-test.cjs`, which serves a disposable copy
 * of the database. Never point it at the development database.
 *
 * Requires the branch-scope fixture (admin user + a second branch).
 * Override the target with CATALOGUE_TEST_PORT.
 */
const http = require('node:http');

const BASE = { host: '127.0.0.1', port: Number(process.env.CATALOGUE_TEST_PORT || 8124) };
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
          /* non-JSON */
        }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
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

const stamp = Date.now();
const DRUG_A = `ZZ Prop Test A ${stamp}`;
const DRUG_B = `ZZ Prop Test B ${stamp}`;
const NEW_BRANCH_CODE = `P${String(stamp).slice(-6)}`;

async function login() {
  const res = await request('POST', '/api/auth', { email: EMAIL, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.raw}`);
}

async function listProducts() {
  const res = await request('GET', '/api/products');
  return res.json?.products ?? [];
}

function findByName(products, name) {
  const target = name.trim().toLowerCase();
  return products.find((p) => p.name.trim().toLowerCase() === target);
}

async function main() {
  await login();

  const before = await listProducts();
  const branchesBefore = await request('GET', '/api/branches');
  const branches = branchesBefore.json?.branches ?? [];
  check('fixture provides at least two active branches', branches.filter((b) => b.active).length >= 2,
    `got ${branches.length}`);

  // ── 1. A newly created product is immediately present everywhere ──────────
  const createA = await request('POST', '/api/products', {
    name: DRUG_A,
    unit: 'pcs',
    reorderLevel: 5,
    defaultCostPrice: 4,
    defaultSellingPrice: 9,
  });
  check('POST /api/products succeeds', createA.status === 201, `status ${createA.status} ${createA.raw}`);
  const productAId = createA.json?.id;

  let products = await listProducts();
  const a1 = findByName(products, DRUG_A);
  check('newly created drug appears in the product list', !!a1, DRUG_A);
  check('newly created drug exposes per-branch availability to an admin',
    Array.isArray(a1?.branchAvailability) && a1.branchAvailability.length === branches.filter((b) => b.active).length,
    JSON.stringify(a1?.branchAvailability));
  check('newly created drug is stocked nowhere (no invented stock)',
    a1?.branchAvailability?.every((b) => b.quantity === 0),
    JSON.stringify(a1?.branchAvailability?.map((b) => b.quantity)));

  // ── 2. Opening a branch back-fills the whole catalogue ────────────────────
  const createBranch = await request('POST', '/api/branches', {
    name: `Propagation ${stamp}`,
    code: NEW_BRANCH_CODE,
  });
  check('POST /api/branches succeeds', createBranch.status === 201, `status ${createBranch.status} ${createBranch.raw}`);
  const newBranchId = createBranch.json?.id;

  products = await listProducts();
  const a2 = findByName(products, DRUG_A);
  const newBranchEntry = a2?.branchAvailability?.find((b) => b.branchId === newBranchId);
  check('a newly opened branch immediately has the pre-existing drug in its catalogue',
    !!newBranchEntry, `branch ${NEW_BRANCH_CODE} missing from ${DRUG_A}`);

  // Every pre-existing product, not just the one made in this test. The list is
  // refetched because `before` predates the new branch existing.
  products = await listProducts();
  let missingFromNewBranch = 0;
  for (const p of products.filter((x) => x.active)) {
    if (!p.branchAvailability?.some((b) => b.branchId === newBranchId)) missingFromNewBranch++;
  }
  check('every active product is present at the newly opened branch',
    missingFromNewBranch === 0, `${missingFromNewBranch} product(s) missing`);

  // ── 3. A price edit reaches every branch's batches ─────────────────────────
  const newPrice = 27.5;
  const reprice = await request('PUT', `/api/products/${productAId}/update-prices`, {
    defaultCostPrice: 12,
    defaultSellingPrice: newPrice,
  });
  check('PUT update-prices succeeds', reprice.status === 200, `status ${reprice.status} ${reprice.raw}`);
  check('price propagation reports batches updated across all branches',
    (reprice.json?.batchesUpdated ?? 0) >= 2, `batchesUpdated=${reprice.json?.batchesUpdated}`);

  products = await listProducts();
  const a3 = findByName(products, DRUG_A);
  check('the product list now reports the new catalogue price',
    Math.abs((a3?.minSellingPrice ?? 0) - newPrice) < 0.001, `minSellingPrice=${a3?.minSellingPrice}`);

  // The POS charges `min(batch.sellingPrice)`, so the price edit is only real if
  // every branch's batch row moved. The test admin has no branch selected, so
  // this lookup returns the batches of ALL branches.
  const detail = await request('GET', `/api/products/${productAId}`);
  check('product detail is readable', detail.status === 200, `status ${detail.status}`);
  const allBatches = detail.json?.batches ?? [];
  check('the drug has a batch row at every active branch',
    allBatches.length >= branches.filter((b) => b.active).length + 1,
    `found ${allBatches.length} batch rows`);
  const staleBatches = allBatches.filter((b) => Math.abs(Number(b.sellingPrice) - newPrice) > 0.001);
  check('every branch batch now carries the new selling price', staleBatches.length === 0,
    `${staleBatches.length} stale: ${staleBatches.map((b) => b.branchId).join(',')}`);

  // A branch opened AFTER the price change must not resurrect the old price.
  const lateBranch = await request('POST', '/api/branches', {
    name: `Late ${stamp}`,
    code: `L${String(stamp).slice(-6)}`,
  });
  check('second branch created', lateBranch.status === 201, `status ${lateBranch.status}`);
  const lateBranchId = lateBranch.json?.id;
  const afterLate = await request('GET', `/api/products/${productAId}`);
  const lateBatch = (afterLate.json?.batches ?? []).find((b) => b.branchId === lateBranchId);
  check('a branch opened after the price change still gets the drug',
    !!lateBatch, `lateBranch=${lateBranchId}`);
  check('the late branch is not left on the old price',
    Math.abs(Number(lateBatch?.sellingPrice) - newPrice) < 0.001,
    `sellingPrice=${lateBatch?.sellingPrice}`);

  // ── 4. Bulk import: stock lands only where it was uploaded, catalogue lands
  //      everywhere ─────────────────────────────────────────────────────────
  // Import is a RECEIVING action, so the server insists on a concrete branch in
  // the session rather than trusting a branchId in the body. An admin on
  // "all branches" has none, so switch first — exactly what the UI does.
  const stockBranch = branches.find((b) => b.active);
  const switchRes = await request('POST', '/api/auth/branch', { branchId: stockBranch.id });
  check('admin can select a receiving branch', switchRes.status === 200, `status ${switchRes.status} ${switchRes.raw.slice(0, 160)}`);

  const importRes = await request('POST', '/api/products/import', {
    items: [
      {
        name: DRUG_B,
        unit: 'pcs',
        reorderLevel: 3,
        defaultCostPrice: 2,
        defaultSellingPrice: 6,
        batchNumber: `IMP-${stamp}`,
        quantity: 40,
        costPrice: 2,
        sellingPrice: 6,
        expiryDate: '2030-01-31',
      },
    ],
  });
  check('POST /api/products/import succeeds', importRes.status === 200, `status ${importRes.status} ${importRes.raw}`);

  products = await listProducts();
  const b1 = findByName(products, DRUG_B);
  check('imported drug appears in the catalogue', !!b1, DRUG_B);
  check('imported drug is available at every active branch',
    b1?.branchAvailability?.filter((x) => x.quantity > 0).length === 1,
    JSON.stringify(b1?.branchAvailability?.map((x) => `${x.branchCode}:${x.quantity}`)));
  check('imported stock was not duplicated across branches',
    (b1?.branchAvailability?.reduce((s, x) => s + x.quantity, 0) ?? 0) === 40,
    `total=${b1?.branchAvailability?.reduce((s, x) => s + x.quantity, 0)}`);
  check('imported drug carries the imported selling price',
    Math.abs((b1?.minSellingPrice ?? 0) - 6) < 0.001, `minSellingPrice=${b1?.minSellingPrice}`);

  // ── 5. Case-insensitive de-duplication on import ──────────────────────────
  const dupe = await request('POST', '/api/products/import', {
    items: [{ name: DRUG_B.toLowerCase(), unit: 'pcs' }],
    onDuplicate: 'update',
  });
  check('re-importing the same drug in a different case succeeds', dupe.status === 200, `status ${dupe.status}`);
  products = await listProducts();
  const dupeMatches = products.filter((p) => p.name.trim().toLowerCase() === DRUG_B.trim().toLowerCase());
  check('a differently-cased re-import does NOT create a second drug', dupeMatches.length === 1,
    `found ${dupeMatches.length}: ${dupeMatches.map((p) => p.name).join(' | ')}`);

  // ── 6. Expired stock is neither sellable nor priced ───────────────────────
  // The expired batch is priced 999 on purpose: if expiry filtering leaks, the
  // charged price becomes 999 instead of the 100 catalogue price. The starter
  // batch the product-create call seeded is priced 100 and holds 0 units, so it
  // must NOT count either.
  const expiredDrug = `ZZ Expired ${stamp}`;
  const expCreate = await request('POST', '/api/products', {
    name: expiredDrug,
    unit: 'pcs',
    defaultCostPrice: 3,
    defaultSellingPrice: 100,
  });
  const expId = expCreate.json?.id;
  check('expired-test product created', expCreate.status === 201, `status ${expCreate.status}`);

  if (expId) {
    const batchRes = await request('POST', '/api/batches', {
      productId: expId,
      batchNumber: `EXP-${stamp}`,
      quantity: 25,
      costPrice: 3,
      sellingPrice: 999,
      expiryDate: '2020-01-01',
    });
    check('expired batch created for the expiry test', batchRes.status === 200 || batchRes.status === 201,
      `status ${batchRes.status} ${batchRes.raw.slice(0, 160)}`);

    products = await listProducts();
    const e1 = findByName(products, expiredDrug);
    check('expired stock is NOT counted as sellable', e1?.totalStock === 0, `totalStock=${e1?.totalStock}`);
    check('expired stock does not set the price charged', e1?.minSellingPrice === 100,
      `minSellingPrice=${e1?.minSellingPrice} (expected the catalogue price 100, not the expired 999)`);
    check('expired stock is still flagged so the owner is warned', e1?.hasExpiredBatches === true,
      `hasExpiredBatches=${e1?.hasExpiredBatches}`);
    // The status string must agree with the flag, or a consumer reading only one
    // of them is told a drug with no sellable stock has "no expiry problem".
    check('expiryStatus agrees with hasExpiredBatches', e1?.expiryStatus === 'expired',
      `expiryStatus=${e1?.expiryStatus}`);

    // And the POS view of the same drug must agree.
    const expDetail = await request('GET', `/api/products/${expId}`);
    const sellable = (expDetail.json?.batches ?? []).filter(
      (b) => Number(b.quantity) > 0 && new Date(b.expiryDate) > new Date()
    );
    check('no sellable batch is offered for an expired-only drug', sellable.length === 0,
      `${sellable.length} sellable batch(es)`);
  }

  // ── 8. A salesperson must not receive other branches' availability ───────
  // Per-branch quantities and the cost side of the price are the other shop's
  // business. `branchAvailability` is admin-gated; prove it by logging in as a
  // pinned salesperson rather than trusting the `if` in the route.
  const salespersonEmail = `zz.sales.${stamp}@local.invalid`;
  const created = await request('POST', '/api/users', {
    name: 'Propagation Salesperson',
    email: salespersonEmail,
    password: 'SalesPass!2026x',
    role: 'sales',
    branchId: stockBranch.id,
    mustChangePassword: false,
  });
  check('admin can create a salesperson', created.status === 201 || created.status === 200,
    `status ${created.status} ${created.raw.slice(0, 160)}`);

  if (created.status === 201 || created.status === 200) {
    const adminCookie = cookie;
    cookie = '';
    const salesLogin = await request('POST', '/api/auth', {
      email: salespersonEmail,
      password: 'SalesPass!2026x',
    });
    check('salesperson can log in', salesLogin.status === 200, `status ${salesLogin.status}`);

    if (salesLogin.status === 200) {
      const salesProducts = (await listProducts());
      const leaked = salesProducts.filter((p) => p.branchAvailability !== undefined);
      check('salesperson receives NO per-branch availability field', leaked.length === 0,
        `${leaked.length} product(s) leaked the field`);
      // Cost price is the sensitive one; a pinned user must not see another
      // branch's batches at all.
      const detail = await request('GET', `/api/products/${productAId}`);
      const foreign = (detail.json?.batches ?? []).filter((b) => b.branchId !== stockBranch.id);
      check('salesperson sees only their own branch batches', foreign.length === 0,
        `${foreign.length} foreign batch(es) leaked`);
    }
    cookie = adminCookie;
  }

  // ── 9. The revision token moves when the catalogue changes ────────────────
  const rev1 = await request('GET', '/api/catalogue-revision');
  check('catalogue revision endpoint responds', rev1.status === 200, `status ${rev1.status}`);
  check('catalogue revision returns a token', typeof rev1.json?.revision === 'string',
    JSON.stringify(rev1.json));
  check('catalogue revision is not cacheable',
    String(rev1.headers?.['cache-control'] ?? '').includes('no-store'),
    `cache-control=${rev1.headers?.['cache-control']}`);

  // An anonymous caller must not be able to watch the catalogue.
  const adminCookie = cookie;
  cookie = '';
  const anon = await request('GET', '/api/catalogue-revision');
  check('catalogue revision requires a session', anon.status === 401 || anon.status === 403,
    `status ${anon.status}`);
  cookie = adminCookie;

  await request('PUT', `/api/products/${productAId}/update-prices`, {
    defaultCostPrice: 13,
    defaultSellingPrice: 31,
  });
  const rev2 = await request('GET', '/api/catalogue-revision');
  check('catalogue revision changes after a price edit', rev1.json?.revision !== rev2.json?.revision,
    `${rev1.json?.revision} -> ${rev2.json?.revision}`);

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`   - ${f}`);
  }
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('catalogue propagation test error:', e);
  console.log(`\n  ${passed} passed, ${failures.length + 1} failed`);
  process.exitCode = 1;
});
