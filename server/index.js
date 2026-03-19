const express = require('express');
const catalyst = require('zcatalyst-sdk-node');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://figma-ab-test-50023798948.development.catalystappsail.in';

const BUCKET_NAME = 'ab-test-images';

// ── Middleware ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '20mb', type: ['application/json', 'text/plain'] }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('AB Test server is running.');
});

// ── Helpers ──
function voterHash(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

function sanitize(str, fallback, maxLen) {
  if (!str || typeof str !== 'string') return fallback;
  return str.trim().slice(0, maxLen);
}

function getCatalystApp(req) {
  return catalyst.initialize(req, { scope: 'admin' });
}

// ── API: Create Test ──
app.post('/api/tests', async (req, res) => {
  try {
    const { title, imageA, imageB, labelA, labelB } = req.body;

    if (!imageA || !imageB || typeof imageA !== 'string' || typeof imageB !== 'string') {
      return res.status(400).json({ error: 'Both images (base64) are required.' });
    }

    const catalystApp = getCatalystApp(req);
    const zcql = catalystApp.zcql();
    const bucket = catalystApp.stratus().bucket(BUCKET_NAME);

    const id = crypto.randomBytes(8).toString('hex');
    const safeTitle = sanitize(title, 'Untitled Test', 100);
    const safeLabelA = sanitize(labelA, 'Option A', 40);
    const safeLabelB = sanitize(labelB, 'Option B', 40);
    const keyA = `${id}_a.png`;
    const keyB = `${id}_b.png`;

    // Upload images to Stratus
    const bufA = Buffer.from(imageA, 'base64');
    const bufB = Buffer.from(imageB, 'base64');
    await Promise.all([
      bucket.putObject(keyA, bufA, { contentType: 'image/png' }),
      bucket.putObject(keyB, bufB, { contentType: 'image/png' })
    ]);

    // Insert row into ABTests table
    await zcql.executeZCQLQuery(
      `INSERT INTO ABTests (test_id, title, label_a, label_b, file_id_a, file_id_b) VALUES ('${id}', '${safeTitle.replace(/'/g, "''")}', '${safeLabelA.replace(/'/g, "''")}', '${safeLabelB.replace(/'/g, "''")}', '${keyA}', '${keyB}')`
    );

    res.json({ id, url: `${BASE_URL}/vote/${id}`, title: safeTitle });
  } catch (err) {
    console.error('Create test error:', err);
    res.status(500).json({ error: 'Failed to create test.' });
  }
});

// ── API: Get Test ──
app.get('/api/tests/:id', async (req, res) => {
  try {
    const catalystApp = getCatalystApp(req);
    const zcql = catalystApp.zcql();
    const testId = req.params.id.replace(/'/g, "''");

    const rows = await zcql.executeZCQLQuery(
      `SELECT * FROM ABTests WHERE test_id = '${testId}'`
    );
    if (!rows.length) return res.status(404).json({ error: 'Test not found.' });

    const test = rows[0].ABTests;
    res.json({
      id: test.test_id,
      title: test.title,
      labelA: test.label_a,
      labelB: test.label_b,
      imageA_url: `${BASE_URL}/api/images/${test.file_id_a}`,
      imageB_url: `${BASE_URL}/api/images/${test.file_id_b}`,
      createdAt: test.CREATEDTIME
    });
  } catch (err) {
    console.error('Get test error:', err);
    res.status(500).json({ error: 'Failed to get test.' });
  }
});

// ── API: Serve Image from Stratus ──
app.get('/api/images/:key', async (req, res) => {
  try {
    const catalystApp = getCatalystApp(req);
    const bucket = catalystApp.stratus().bucket(BUCKET_NAME);
    const key = req.params.key;

    // Validate key format (only allow alphanumeric, underscore, dot)
    if (!/^[a-z0-9_]+\.png$/i.test(key)) {
      return res.status(400).json({ error: 'Invalid image key.' });
    }

    const stream = await bucket.getObject(key);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    stream.pipe(res);
  } catch (err) {
    console.error('Image fetch error:', err);
    res.status(404).json({ error: 'Image not found.' });
  }
});

// ── API: Vote ──
app.post('/api/tests/:id/vote', async (req, res) => {
  try {
    const { choice } = req.body;
    if (!choice || !['A', 'B'].includes(choice)) {
      return res.status(400).json({ error: 'Choice must be "A" or "B".' });
    }

    const catalystApp = getCatalystApp(req);
    const zcql = catalystApp.zcql();
    const testId = req.params.id.replace(/'/g, "''");

    // Check test exists
    const testRows = await zcql.executeZCQLQuery(
      `SELECT test_id FROM ABTests WHERE test_id = '${testId}'`
    );
    if (!testRows.length) return res.status(404).json({ error: 'Test not found.' });

    const hash = voterHash(req);

    // Check if already voted
    const existing = await zcql.executeZCQLQuery(
      `SELECT ROWID FROM Votes WHERE test_id = '${testId}' AND voter_hash = '${hash}'`
    );

    if (existing.length) {
      const rowId = existing[0].Votes.ROWID;
      await zcql.executeZCQLQuery(
        `UPDATE Votes SET choice = '${choice}' WHERE ROWID = ${rowId}`
      );
      res.json({ success: true, changed: true });
    } else {
      await zcql.executeZCQLQuery(
        `INSERT INTO Votes (test_id, choice, voter_hash) VALUES ('${testId}', '${choice}', '${hash}')`
      );
      res.json({ success: true });
    }
  } catch (err) {
    console.error('Vote error:', err);
    res.status(500).json({ error: 'Failed to record vote.' });
  }
});

// ── API: Results ──
app.get('/api/tests/:id/results', async (req, res) => {
  try {
    const catalystApp = getCatalystApp(req);
    const zcql = catalystApp.zcql();
    const testId = req.params.id.replace(/'/g, "''");

    const testRows = await zcql.executeZCQLQuery(
      `SELECT * FROM ABTests WHERE test_id = '${testId}'`
    );
    if (!testRows.length) return res.status(404).json({ error: 'Test not found.' });

    const test = testRows[0].ABTests;

    const countA = await zcql.executeZCQLQuery(
      `SELECT COUNT(ROWID) FROM Votes WHERE test_id = '${testId}' AND choice = 'A'`
    );
    const countB = await zcql.executeZCQLQuery(
      `SELECT COUNT(ROWID) FROM Votes WHERE test_id = '${testId}' AND choice = 'B'`
    );
    const votesA = countA.length ? parseInt(countA[0].Votes['COUNT(ROWID)']) || 0 : 0;
    const votesB = countB.length ? parseInt(countB[0].Votes['COUNT(ROWID)']) || 0 : 0;

    res.json({
      id: test.test_id,
      title: test.title,
      labelA: test.label_a,
      labelB: test.label_b,
      votesA,
      votesB,
      totalVotes: votesA + votesB,
      imageA_url: `${BASE_URL}/api/images/${test.file_id_a}`,
      imageB_url: `${BASE_URL}/api/images/${test.file_id_b}`
    });
  } catch (err) {
    console.error('Results error:', err);
    res.status(500).json({ error: 'Failed to get results.' });
  }
});

// ── Privacy Policy ──
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// ── Serve Voting Page ──
app.get('/vote/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

// ── Delete Test ──
app.post('/api/tests/:id/delete', async (req, res) => {
  try {
    const catalystApp = getCatalystApp(req);
    const zcql = catalystApp.zcql();
    const bucket = catalystApp.stratus().bucket(BUCKET_NAME);
    const testId = req.params.id.replace(/'/g, "''");

    const testRows = await zcql.executeZCQLQuery(
      `SELECT * FROM ABTests WHERE test_id = '${testId}'`
    );
    if (!testRows.length) return res.status(404).json({ error: 'Test not found.' });

    const test = testRows[0].ABTests;

    // Delete votes and test row
    await zcql.executeZCQLQuery(`DELETE FROM Votes WHERE test_id = '${testId}'`);
    await zcql.executeZCQLQuery(`DELETE FROM ABTests WHERE test_id = '${testId}'`);

    // Delete images from Stratus
    try {
      await bucket.deleteObjects([
        { key: test.file_id_a },
        { key: test.file_id_b }
      ]);
    } catch (_) {}

    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete test.' });
  }
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`AB Test server running at ${BASE_URL}`);
});
