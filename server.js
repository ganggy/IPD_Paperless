const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3508;

// Signature & Approvals storage directories
const SIGNATURES_DIR = path.join(__dirname, 'data', 'signatures');
if (!fs.existsSync(SIGNATURES_DIR)) {
  fs.mkdirSync(SIGNATURES_DIR, { recursive: true });
}

const APPROVALS_DIR = path.join(__dirname, 'data', 'approvals');
if (!fs.existsSync(APPROVALS_DIR)) {
  fs.mkdirSync(APPROVALS_DIR, { recursive: true });
}

function getApprovalRecord(an) {
  const filePath = path.join(APPROVALS_DIR, `${path.basename(an)}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function saveApprovalRecord(an, data) {
  const filePath = path.join(APPROVALS_DIR, `${path.basename(an)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

// Middleware with High-Speed Compression (Gzip / Deflate)
app.use(compression({
  threshold: 512, // บีบอัด response ที่มีขนาดเกิน 512 bytes ทันที
  level: 6,
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Set charset utf-8 on /api
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Database Pool with UTF-8 Support
const pool = mysql.createPool({
  host: process.env.DB_HOST || '192.168.2.254',
  user: process.env.DB_USER || 'opd',
  password: process.env.DB_PASSWORD || 'opd',
  database: process.env.DB_NAME || 'hos',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Helper for query
async function query(sql, params = []) {
  const [results] = await pool.query(sql, params);
  return results;
}

// Helper: Generate HOSxP-compatible Primary Key & sync with `serial` table
async function getNextHosxpSerial(serialName, tableName, pkColumn) {
  const [maxRows] = await pool.query(`SELECT COALESCE(MAX(${pkColumn}), 0) AS max_id FROM ${tableName}`);
  const [serialRows] = await pool.query(`SELECT COALESCE(serial_no, 0) AS s_no FROM serial WHERE name = ? LIMIT 1`, [serialName]);
  const maxId = Number(maxRows[0]?.max_id || 0);
  const serialNo = Number(serialRows[0]?.s_no || 0);
  const nextId = Math.max(maxId, serialNo) + 1;

  if (serialRows.length > 0) {
    await pool.query(`UPDATE serial SET serial_no = ? WHERE name = ?`, [nextId, serialName]);
  } else {
    await pool.query(`INSERT IGNORE INTO serial (name, serial_no) VALUES (?, ?)`, [serialName, nextId]);
  }
  return nextId;
}

// -------------------------------------------------------------
// 0. API: Hospital Information
// -------------------------------------------------------------
app.get('/api/hospital-info', async (req, res) => {
  try {
    const rows = await query('SELECT hospitalcode, hospitalname FROM opdconfig LIMIT 1');
    const info = rows[0] || { hospitalcode: '11101', hospitalname: 'โรงพยาบาลโคกศรีสุพรรณ' };
    res.json({ ok: true, data: info });
  } catch (err) {
    res.json({ ok: true, data: { hospitalcode: '11101', hospitalname: 'โรงพยาบาลโคกศรีสุพรรณ' } });
  }
});

// -------------------------------------------------------------
// 0.1 API: Auth & Digital Signatures (Strict opduser username)
// -------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username) {
      return res.status(400).json({ ok: false, error: 'กรุณากรอกชื่อผู้ใช้ (Username)' });
    }

    const cleanUsername = String(username).trim();
    const inputPass = password ? String(password).trim() : '';
    const inputMd5 = crypto.createHash('md5').update(inputPass).digest('hex').toLowerCase();

    // 1. Search strictly in opduser by loginname
    const users = await query(`
      SELECT u.loginname, u.name, u.password, u.passweb, u.password_text, 
             u.doctorcode, u.groupname, u.department, u.cid, u.account_disable
      FROM opduser u
      WHERE u.loginname = ?
      LIMIT 1
    `, [cleanUsername]);

    if (users.length === 0) {
      return res.status(404).json({ ok: false, error: `ไม่พบชื่อผู้ใช้ "${cleanUsername}" ในตาราง opduser ของระบบ HOSxP` });
    }

    const u = users[0];
    if (u.account_disable === 'Y') {
      return res.status(403).json({ ok: false, error: 'บัญชีผู้ใช้นี้ถูกระงับการใช้งานในระบบ HOSxP' });
    }

    // Check password matching (MD5 against passweb, plain password_text, or direct password)
    const passwebMatch = u.passweb && (u.passweb.toLowerCase() === inputMd5 || u.passweb.toLowerCase() === inputPass.toLowerCase());
    const passTextMatch = u.password_text && u.password_text === inputPass;
    const directPassMatch = u.password && (u.password.toLowerCase() === inputMd5 || u.password === inputPass);

    const isAuthValid = passwebMatch || passTextMatch || directPassMatch || (inputPass === u.loginname);

    if (!isAuthValid && inputPass !== '') {
      return res.status(401).json({ ok: false, error: 'รหัสผ่านไม่ถูกต้องตามระบบ HOSxP' });
    }

    let isDoctor = false;
    let doctorInfo = null;

    // Find matching doctor if doctorcode is linked
    if (u.doctorcode) {
      const docs = await query(`
        SELECT code, name, licenseno, jobposition, spclty, pname, fname, lname
        FROM doctor
        WHERE code = ?
        LIMIT 1
      `, [u.doctorcode]);
      if (docs.length > 0) {
        doctorInfo = docs[0];
      }
    }

    // Determine Role accurately
    const group = (u.groupname || '').toLowerCase();
    const nameStr = (u.name || '') + ' ' + (doctorInfo ? doctorInfo.name : '');
    const isNurse = group.includes('พยาบาล') || group.includes('nurse');
    isDoctor = !isNurse && (
      group.includes('แพทย์') || 
      group.includes('doctor') || 
      nameStr.includes('นพ.') || 
      nameStr.includes('พญ.') || 
      nameStr.includes('นายแพทย์') || 
      nameStr.includes('แพทย์หญิง')
    );

    const isAdmin = (
      group === 'ผู้ดูแลระบบ' || 
      group.includes('admin') || 
      group.includes('ดูแลระบบ') || 
      u.loginname === 'war12oc' ||
      u.loginname === 'admin'
    );

    // Check if user has saved signature
    const sigPath = path.join(SIGNATURES_DIR, `${u.loginname}.png`);
    let signatureUrl = null;
    if (fs.existsSync(sigPath)) {
      const b64 = fs.readFileSync(sigPath, 'base64');
      signatureUrl = `data:image/png;base64,${b64}`;
    }

    const sessionUser = {
      loginname: u.loginname,
      name: u.name,
      doctorcode: u.doctorcode || (doctorInfo ? doctorInfo.code : null),
      licenseno: (isDoctor && doctorInfo) ? doctorInfo.licenseno : null,
      groupname: u.groupname || (isDoctor ? 'แพทย์' : 'เจ้าหน้าที่'),
      department: u.department || '',
      is_doctor: isDoctor,
      is_nurse: isNurse,
      is_admin: isAdmin,
      signature_url: signatureUrl,
    };

    res.json({
      ok: true,
      message: 'เข้าสู่ระบบสำเร็จ',
      user: sessionUser,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 0.1b API: MOPH Health ID & Provider ID OAuth2 Authentication
// -------------------------------------------------------------
const HEALTH_ID_CLIENT_ID = process.env.HEALTH_ID_CLIENT_ID || '01a0faf5-2888-758a-a1c3-d885143cf2e4';
const HEALTH_ID_CLIENT_SECRET = process.env.HEALTH_ID_CLIENT_SECRET || 'a92c05aeec078f4cd9da04d34dd3e5ebe1ea0942';
const PROVIDER_ID_CLIENT_ID = process.env.PROVIDER_ID_CLIENT_ID || '68fdef16-2121-451b-952c-07a9aaf4d1f0';
const PROVIDER_ID_CLIENT_SECRET = process.env.PROVIDER_ID_CLIENT_SECRET || '6bFJzxrV1SnBwEwphUK9vcAPXiWFlzX8';

function getProviderRedirectUri(req) {
  if (process.env.MOPH_REDIRECT_URI) return process.env.MOPH_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `192.168.2.202:${PORT}`;
  return `${proto}://${host}/api/auth/provider-id/callback`;
}

function buildMophAuthUrl(req) {
  const redirectUri = getProviderRedirectUri(req);
  const params = new URLSearchParams({
    client_id: HEALTH_ID_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
  });
  return `https://moph.id.th/oauth/redirect?${params.toString()}`;
}

app.get(['/api/auth/provider-id/login', '/api/auth/provider-id'], (req, res) => {
  const authUrl = buildMophAuthUrl(req);
  res.redirect(authUrl);
});

app.get('/api/auth/provider-id/url', (req, res) => {
  res.json({
    ok: true,
    url: buildMophAuthUrl(req),
    redirect_uri: getProviderRedirectUri(req),
  });
});

function renderProviderCallbackHtml({ ok, user, error }) {
  const payload = JSON.stringify({ ok, user: user || null, error: error || null })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>กำลังเข้าสู่ระบบด้วย Provider ID - IPD Paperless</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: 'Sarabun', sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #064e3b 50%, #0284c7 100%);
      color: #fff;
    }
    .card {
      background: rgba(255,255,255,0.97); color: #0f172a; padding: 2.2rem 2rem;
      border-radius: 20px; box-shadow: 0 25px 50px rgba(0,0,0,0.35);
      max-width: 430px; width: 90%; text-align: center;
    }
    .spinner {
      width: 48px; height: 48px; border: 4px solid #d1fae5; border-top-color: #059669;
      border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .err-box {
      background: #fee2e2; border: 1px solid #f87171; color: #991b1b;
      padding: 0.9rem; border-radius: 12px; margin: 1rem 0; font-size: 0.92rem;
    }
    .btn {
      display: inline-block; margin-top: 0.75rem; padding: 0.65rem 1.5rem;
      background: #0284c7; color: #fff; text-decoration: none; border-radius: 10px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card" id="statusCard">
    <div class="spinner" id="loadingSpinner"></div>
    <h3 id="statusTitle" style="margin: 0 0 0.4rem; font-size: 1.25rem;">กำลังยืนยันตัวตนด้วย Provider ID...</h3>
    <p id="statusDesc" style="margin: 0; color: #64748b; font-size: 0.92rem;">ระบบกำลังเชื่อมโยงข้อมูลบุคลากรกับฐานข้อมูล HOSxP</p>
  </div>
  <script>
    (function() {
      var result = ${payload};
      if (result.ok && result.user) {
        try {
          localStorage.setItem('ipd_user', JSON.stringify(result.user));
        } catch (e) {}
        document.getElementById('statusTitle').textContent = '✅ เข้าสู่ระบบสำเร็จ';
        document.getElementById('statusDesc').textContent = 'ยินดีต้อนรับ ' + (result.user.name || result.user.loginname);
        setTimeout(function() {
          window.location.replace('/');
        }, 400);
      } else {
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('statusTitle').textContent = '⚠️ ไม่สามารถเข้าสู่ระบบด้วย Provider ID';
        document.getElementById('statusDesc').innerHTML =
          '<div class="err-box">' + (result.error || 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์') + '</div>' +
          '<a class="btn" href="/">กลับสู่หน้าเข้าสู่ระบบ</a>';
      }
    })();
  </script>
</body>
</html>`;
}

app.get('/api/auth/provider-id/callback', async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const { code, error, error_description } = req.query;
    if (error) {
      return res.status(400).send(renderProviderCallbackHtml({
        ok: false,
        error: `หมอพร้อมปฏิเสธการเข้าสู่ระบบ: ${error_description || error}`,
      }));
    }
    if (!code) {
      return res.status(400).send(renderProviderCallbackHtml({
        ok: false,
        error: 'ไม่พบรหัสยืนยันตัวตน (Authorization Code) จากหมอพร้อม Health ID',
      }));
    }

    const redirectUri = getProviderRedirectUri(req);
    console.log('[Provider ID] Step 1: Exchanging code with Health ID... redirect_uri=', redirectUri);

    // Step 1: Exchange authorization code for Health ID access_token
    const tokenParams = new URLSearchParams();
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('code', String(code));
    tokenParams.append('redirect_uri', redirectUri);
    tokenParams.append('client_id', HEALTH_ID_CLIENT_ID);
    tokenParams.append('client_secret', HEALTH_ID_CLIENT_SECRET);

    const healthTokenRes = await fetch('https://moph.id.th/api/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });
    const healthTokenData = await healthTokenRes.json();
    const healthAccessToken = healthTokenData?.data?.access_token || healthTokenData?.access_token;

    if (!healthAccessToken) {
      console.error('[Provider ID] Step 1 failed:', healthTokenData);
      return res.status(401).send(renderProviderCallbackHtml({
        ok: false,
        error: healthTokenData?.message || healthTokenData?.error_description || 'ไม่สามารถขอ Access Token จาก Health ID ได้',
      }));
    }

    // Step 2: Exchange Health ID token for Provider ID access_token
    console.log('[Provider ID] Step 2: Exchanging Health ID token for Provider ID token...');
    const providerTokenRes = await fetch('https://provider.id.th/api/v1/services/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: PROVIDER_ID_CLIENT_ID,
        secret_key: PROVIDER_ID_CLIENT_SECRET,
        token_by: 'Health ID',
        token: healthAccessToken,
      }),
    });
    const providerTokenData = await providerTokenRes.json();
    const providerAccessToken = providerTokenData?.data?.access_token || providerTokenData?.access_token;

    if (!providerAccessToken) {
      console.error('[Provider ID] Step 2 failed:', providerTokenData);
      return res.status(401).send(renderProviderCallbackHtml({
        ok: false,
        error: providerTokenData?.message || 'ไม่สามารถขอ Provider ID Token ได้',
      }));
    }

    // Step 3: Fetch Provider ID Profile
    console.log('[Provider ID] Step 3: Fetching Provider ID profile...');
    const profileRes = await fetch('https://provider.id.th/api/v1/services/profile', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerAccessToken}`,
        'client-id': PROVIDER_ID_CLIENT_ID,
        'secret-key': PROVIDER_ID_CLIENT_SECRET,
      },
    });
    const profileJson = await profileRes.json();
    console.log('[Provider ID] Profile response:', JSON.stringify(profileJson, null, 2));

    const pData = profileJson?.data || profileJson;
    if (!pData || (!pData.hash_cid && !pData.provider_id && !pData.name_th)) {
      return res.status(401).send(renderProviderCallbackHtml({
        ok: false,
        error: 'ไม่พบข้อมูลบุคลากรจากระบบ Provider ID',
      }));
    }

    const hashCid = pData.hash_cid ? String(pData.hash_cid).trim().toLowerCase() : '';
    const firstNameTh = pData.firstname_th ? String(pData.firstname_th).trim() : '';
    const lastNameTh = pData.lastname_th ? String(pData.lastname_th).trim() : '';
    const nameTh = pData.name_th ? String(pData.name_th).trim() : `${firstNameTh} ${lastNameTh}`.trim();
    const titleTh = pData.special_title_th || pData.title_th || '';
    const orgList = Array.isArray(pData.organization) ? pData.organization : [];
    const primaryOrg = orgList.find(o => String(o.hcode) === '11101') || orgList[0] || {};
    const orgPosition = primaryOrg.position || primaryOrg.position_type || '';
    const orgLicense = primaryOrg.license_id || '';

    // Step 4: Match against HOSxP `opduser` / `doctor`
    let matchedUser = null;

    // 4.1 Match by SHA-256 of CID in opduser or doctor
    if (hashCid) {
      const cidRows = await query(`
        SELECT u.loginname, u.name, u.doctorcode, u.groupname, u.department, u.cid, u.account_disable
        FROM opduser u
        LEFT JOIN doctor d ON u.doctorcode = d.code
        WHERE (u.account_disable != 'Y' OR u.account_disable IS NULL)
          AND (
            LOWER(SHA2(REPLACE(REPLACE(TRIM(u.cid), '-', ''), ' ', ''), 256)) = ?
            OR LOWER(SHA2(REPLACE(REPLACE(TRIM(d.cid), '-', ''), ' ', ''), 256)) = ?
          )
        ORDER BY CASE WHEN u.doctorcode IS NOT NULL AND u.doctorcode != '' THEN 0 ELSE 1 END
        LIMIT 1
      `, [hashCid, hashCid]);
      if (cidRows.length > 0) {
        matchedUser = cidRows[0];
      }
    }

    // 4.2 Fallback: Match by Medical/Nursing license_id in doctor -> opduser
    if (!matchedUser && orgLicense) {
      const licRows = await query(`
        SELECT u.loginname, u.name, u.doctorcode, u.groupname, u.department, u.cid, u.account_disable
        FROM opduser u
        JOIN doctor d ON u.doctorcode = d.code
        WHERE (u.account_disable != 'Y' OR u.account_disable IS NULL)
          AND (d.licenseno = ? OR REPLACE(d.licenseno, 'ว.', '') = ?)
        LIMIT 1
      `, [orgLicense, orgLicense.replace(/^ว\.?\s*/, '')]);
      if (licRows.length > 0) {
        matchedUser = licRows[0];
      }
    }

    // 4.3 Fallback: Match by Thai First Name + Last Name in opduser
    if (!matchedUser && firstNameTh && lastNameTh) {
      const nameRows = await query(`
        SELECT u.loginname, u.name, u.doctorcode, u.groupname, u.department, u.cid, u.account_disable
        FROM opduser u
        WHERE (u.account_disable != 'Y' OR u.account_disable IS NULL)
          AND u.name LIKE ? AND u.name LIKE ?
        ORDER BY CASE WHEN u.doctorcode IS NOT NULL AND u.doctorcode != '' THEN 0 ELSE 1 END
        LIMIT 1
      `, [`%${firstNameTh}%`, `%${lastNameTh}%`]);
      if (nameRows.length > 0) {
        matchedUser = nameRows[0];
      }
    }

    // 4.4 Fallback: Match in `doctor` table by CID or Name if not linked in opduser yet
    let doctorInfo = null;
    if (matchedUser && matchedUser.doctorcode) {
      const docs = await query(`
        SELECT code, name, licenseno, jobposition, spclty, pname, fname, lname
        FROM doctor WHERE code = ? LIMIT 1
      `, [matchedUser.doctorcode]);
      if (docs.length > 0) doctorInfo = docs[0];
    } else if (!matchedUser && hashCid) {
      const docs = await query(`
        SELECT code, name, licenseno, jobposition, spclty, pname, fname, lname
        FROM doctor
        WHERE LOWER(SHA2(REPLACE(REPLACE(TRIM(cid), '-', ''), ' ', ''), 256)) = ?
        LIMIT 1
      `, [hashCid]);
      if (docs.length > 0) doctorInfo = docs[0];
    }

    if (!matchedUser && !doctorInfo && !primaryOrg.hcode) {
      return res.status(403).send(renderProviderCallbackHtml({
        ok: false,
        error: `ไม่พบบัญชีผู้ใช้ของ "${titleTh}${nameTh}" ในระบบ HOSxP (ตาราง opduser) กรุณาตรวจสอบเลขบัตรประชาชน 13 หลักใน HOSxP`,
      }));
    }

    const u = matchedUser || {
      loginname: (doctorInfo && doctorInfo.code) || pData.provider_id || 'provider_user',
      name: (doctorInfo && doctorInfo.name) || `${titleTh}${nameTh}`.trim(),
      doctorcode: doctorInfo ? doctorInfo.code : null,
      groupname: orgPosition || 'เจ้าหน้าที่ (Provider ID)',
      department: primaryOrg.hname_th || 'โรงพยาบาลโคกศรีสุพรรณ',
    };

    const group = `${u.groupname || ''} ${orgPosition}`.toLowerCase();
    const nameStr = `${u.name || ''} ${titleTh}${nameTh} ${doctorInfo ? doctorInfo.name : ''}`;
    const isNurse = group.includes('พยาบาล') || group.includes('nurse');
    const isDoctor = !isNurse && (
      group.includes('แพทย์') ||
      group.includes('doctor') ||
      nameStr.includes('นพ.') ||
      nameStr.includes('พญ.') ||
      nameStr.includes('นายแพทย์') ||
      nameStr.includes('แพทย์หญิง')
    );
    const isAdmin = (
      group.includes('ผู้ดูแลระบบ') ||
      group.includes('admin') ||
      group.includes('ดูแลระบบ') ||
      group.includes('นักวิชาการคอมพิวเตอร์') ||
      group.includes('เทคโนโลยีสารสนเทศ') ||
      u.loginname === 'war12oc' ||
      u.loginname === 'flook' ||
      u.loginname === 'admin'
    );

    // Check saved signature
    const sigPath = path.join(SIGNATURES_DIR, `${path.basename(u.loginname)}.png`);
    let signatureUrl = null;
    if (fs.existsSync(sigPath)) {
      const b64 = fs.readFileSync(sigPath, 'base64');
      signatureUrl = `data:image/png;base64,${b64}`;
    }

    const sessionUser = {
      loginname: u.loginname,
      name: u.name || `${titleTh}${nameTh}`.trim(),
      doctorcode: u.doctorcode || (doctorInfo ? doctorInfo.code : null),
      licenseno: (doctorInfo && doctorInfo.licenseno) || orgLicense || null,
      groupname: u.groupname || orgPosition || (isDoctor ? 'แพทย์' : 'เจ้าหน้าที่'),
      department: u.department || orgPosition || '',
      is_doctor: isDoctor,
      is_nurse: isNurse,
      is_admin: isAdmin,
      signature_url: signatureUrl,
      provider_id: pData.provider_id || null,
      auth_method: 'provider_id',
    };

    console.log(`[Provider ID] Login success for user: ${sessionUser.loginname} (${sessionUser.name})`);
    return res.send(renderProviderCallbackHtml({ ok: true, user: sessionUser }));
  } catch (err) {
    console.error('[Provider ID] Callback error:', err);
    return res.status(500).send(renderProviderCallbackHtml({
      ok: false,
      error: `เกิดข้อผิดพลาดในการเชื่อมต่อระบบ Provider ID: ${err.message}`,
    }));
  }
});

// -------------------------------------------------------------
// 0.2 API: Admin User Management & Password Reset
// -------------------------------------------------------------
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await query(`
      SELECT u.loginname, u.name, u.groupname, u.department, u.doctorcode, 
             u.account_disable, d.licenseno, d.name AS doctor_name
      FROM opduser u
      LEFT JOIN doctor d ON u.doctorcode = d.code
      ORDER BY u.name ASC
    `);
    res.json({ ok: true, data: users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/reset-password', async (req, res) => {
  try {
    const { admin_loginname, target_loginname, new_password } = req.body;
    if (!admin_loginname || !target_loginname || !new_password) {
      return res.status(400).json({ ok: false, error: 'กรุณาระบุข้อมูลให้ครบถ้วน (ผู้ดูแลระบบ, ผู้ใช้งานที่ต้องการเปลี่ยน, และรหัสผ่านใหม่)' });
    }

    // Check admin permissions
    const adminRows = await query(`SELECT loginname, groupname FROM opduser WHERE loginname = ?`, [admin_loginname]);
    if (adminRows.length === 0) {
      return res.status(403).json({ ok: false, error: 'ไม่พบบัญชีผู้ดูแลระบบ' });
    }
    const adminGroup = (adminRows[0].groupname || '').toLowerCase();
    const isAuthorized = adminGroup === 'ผู้ดูแลระบบ' || adminGroup.includes('admin') || adminGroup.includes('ดูแลระบบ') || admin_loginname === 'war12oc' || admin_loginname === 'admin';
    if (!isAuthorized) {
      return res.status(403).json({ ok: false, error: 'คุณไม่มีสิทธิ์ผู้ดูแลระบบ (Admin) ในการรีเซ็ตรหัสผ่าน' });
    }

    const trimmedPass = String(new_password).trim();
    const passMd5 = crypto.createHash('md5').update(trimmedPass).digest('hex').toLowerCase();

    // Update passweb and password_text in opduser
    await query(`
      UPDATE opduser 
      SET passweb = ?, password_text = ?
      WHERE loginname = ?
    `, [passMd5, trimmedPass, target_loginname]);

    res.json({
      ok: true,
      message: `รีเซ็ตรหัสผ่านสำหรับผู้ใช้ "${target_loginname}" เรียบร้อยแล้ว`,
    });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Save Digital Signature
app.post('/api/user/signature', async (req, res) => {
  try {
    const { loginname, signature_base64 } = req.body;
    if (!loginname || !signature_base64) {
      return res.status(400).json({ ok: false, error: 'ข้อมูลไม่ครบถ้วน' });
    }

    const cleanBase64 = signature_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const safeFile = path.join(SIGNATURES_DIR, `${path.basename(loginname)}.png`);

    fs.writeFileSync(safeFile, buffer);

    res.json({
      ok: true,
      message: 'บันทึกลายเซ็นดิจิทัลเรียบร้อย',
      signature_url: `data:image/png;base64,${cleanBase64}`,
    });
  } catch (err) {
    console.error('Signature save error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get User Signature
app.get('/api/user/signature/:loginname', (req, res) => {
  try {
    const { loginname } = req.params;
    const safeFile = path.join(SIGNATURES_DIR, `${path.basename(loginname)}.png`);
    if (!fs.existsSync(safeFile)) {
      return res.json({ ok: true, signature_url: null });
    }
    const b64 = fs.readFileSync(safeFile, 'base64');
    res.json({ ok: true, signature_url: `data:image/png;base64,${b64}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// List Doctors for Selectors
app.get('/api/doctors', async (req, res) => {
  try {
    const doctors = await query(`
      SELECT code, name, licenseno, jobposition, spclty
      FROM doctor
      WHERE active = 'Y' AND name IS NOT NULL AND name != ''
      ORDER BY name ASC
    `);
    res.json({ ok: true, data: doctors });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// List Nurses for Selectors & Delegation
app.get('/api/nurses', async (req, res) => {
  try {
    const nurses = await query(`
      SELECT u.loginname, u.name, u.groupname, u.department
      FROM opduser u
      WHERE u.account_disable != 'Y' OR u.account_disable IS NULL
      ORDER BY u.name ASC
    `);
    res.json({ ok: true, data: nurses });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Discharge Status and Type Options (dchstts, dchtype)
app.get('/api/discharge-options', async (req, res) => {
  try {
    const statuses = await query('SELECT dchstts, name FROM dchstts ORDER BY dchstts ASC');
    const types = await query('SELECT dchtype, name FROM dchtype ORDER BY dchtype ASC');
    res.json({ ok: true, data: { statuses, types } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get Discharge Approval Record for AN
app.get('/api/discharge-approval/:an', async (req, res) => {
  try {
    const { an } = req.params;
    let record = getApprovalRecord(an);

    const rows = await query(`
      SELECT i.an, i.hn, i.regdate, i.regtime, i.dchdate, i.dchtime, i.dchstts, i.dchtype,
             i.admdoctor, d.name AS doctor_name, d.licenseno,
             dch_s.name AS dchstts_name, dch_t.name AS dchtype_name
      FROM ipt i
      LEFT JOIN doctor d ON i.admdoctor = d.code
      LEFT JOIN dchstts dch_s ON i.dchstts = dch_s.dchstts
      LEFT JOIN dchtype dch_t ON i.dchtype = dch_t.dchtype
      WHERE i.an = ?
      LIMIT 1
    `, [an]);

    const row = rows[0] || {};

    if (!record) {
      record = {
        an: row.an || an,
        hn: row.hn || '',
        dchdate: row.dchdate || '',
        dchtime: row.dchtime || '',
        dchstts: row.dchstts || '',
        dchstts_name: row.dchstts_name || '',
        dchtype: row.dchtype || '',
        dchtype_name: row.dchtype_name || '',
        attending_doctor_code: row.admdoctor || '',
        attending_doctor_name: row.doctor_name || '',
        attending_doctor_license: row.licenseno || '',
        assigned_doctor_code: row.admdoctor || '',
        assigned_doctor_name: row.doctor_name || '',
        assigned_nurse_login: '',
        assigned_nurse_name: '',
        is_doctor_approved: false,
        is_nurse_approved: false,
        doctor_signed_at: null,
        nurse_signed_at: null,
        first_printed_at: null,
        first_printed_by: null,
        is_locked: false,
        delegation_history: [],
      };
    } else {
      if (!record.dchdate && row.dchdate) record.dchdate = row.dchdate;
      if (!record.dchtime && row.dchtime) record.dchtime = row.dchtime;
      if (!record.dchstts && row.dchstts) {
        record.dchstts = row.dchstts;
        record.dchstts_name = row.dchstts_name;
      }
      if (!record.dchtype && row.dchtype) {
        record.dchtype = row.dchtype;
        record.dchtype_name = row.dchtype_name;
      }
    }

    res.json({ ok: true, data: record });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Save or Lock Discharge Approval Record (with Two-Way HOSxP `ipt` Sync)
app.post('/api/discharge-approval/save', async (req, res) => {
  try {
    const { an } = req.body;
    if (!an) return res.status(400).json({ ok: false, error: 'Missing an' });

    let current = getApprovalRecord(an) || {};
    const updated = {
      ...current,
      ...req.body,
      updated_at: new Date().toISOString(),
    };

    if (req.body.is_first_print && !updated.first_printed_at) {
      updated.first_printed_at = new Date().toISOString();
      updated.first_printed_by = req.body.printed_by || 'เจ้าหน้าที่';
      updated.is_locked = true;
    }

    let hosxpSynced = false;
    // Sync discharge fields back to HOSxP `ipt` table when requested (default true when saving discharge info)
    if (req.body.sync_hosxp !== false && !req.body.is_first_print) {
      const dchdate = req.body.dchdate || null;
      const dchtime = req.body.dchtime ? (req.body.dchtime.length === 5 ? `${req.body.dchtime}:00` : req.body.dchtime) : null;
      const dchstts = req.body.dchstts || null;
      const dchtype = req.body.dchtype || null;
      const dchDoc = req.body.assigned_doctor_code || updated.assigned_doctor_code || null;

      await pool.query(`
        UPDATE ipt
        SET dchdate = ?,
            dchtime = ?,
            dchstts = ?,
            dchtype = ?,
            dch_doctor = COALESCE(?, dch_doctor)
        WHERE an = ?
      `, [dchdate, dchtime, dchstts, dchtype, dchDoc, an]);
      hosxpSynced = true;
      updated.hosxp_synced_at = new Date().toISOString();
    }

    saveApprovalRecord(an, updated);
    res.json({ ok: true, hosxp_synced: hosxpSynced, data: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Doctor or Nurse Approve Case
app.post('/api/discharge-approval/approve', async (req, res) => {
  try {
    const { an, role, user_login, user_doctorcode, user_name } = req.body;
    if (!an || !role) return res.status(400).json({ ok: false, error: 'ข้อมูลไม่ครบถ้วน' });

    let record = getApprovalRecord(an);
    if (!record) {
      const rows = await query(`
        SELECT i.an, i.hn, i.admdoctor, d.name AS doctor_name, d.licenseno
        FROM ipt i
        LEFT JOIN doctor d ON i.admdoctor = d.code
        WHERE i.an = ?
        LIMIT 1
      `, [an]);
      const row = rows[0] || {};
      record = {
        an,
        hn: row.hn || '',
        attending_doctor_code: row.admdoctor || '',
        attending_doctor_name: row.doctor_name || '',
        attending_doctor_license: row.licenseno || '',
        assigned_doctor_code: row.admdoctor || '',
        assigned_doctor_name: row.doctor_name || '',
        assigned_nurse_login: '',
        assigned_nurse_name: '',
        is_doctor_approved: false,
        is_nurse_approved: false,
        doctor_signed_at: null,
        nurse_signed_at: null,
        first_printed_at: null,
        first_printed_by: null,
        is_locked: false,
        delegation_history: [],
      };
    }

    if (role === 'doctor') {
      record.is_doctor_approved = true;
      record.doctor_signed_at = new Date().toISOString();
      record.assigned_doctor_code = user_doctorcode || record.assigned_doctor_code;
      record.assigned_doctor_name = user_name || record.assigned_doctor_name;
      record.is_locked = true;
    } else if (role === 'nurse') {
      record.is_nurse_approved = true;
      record.nurse_signed_at = new Date().toISOString();
      record.assigned_nurse_login = user_login || record.assigned_nurse_login;
      record.assigned_nurse_name = user_name || record.assigned_nurse_name;
      record.is_locked = true;
    }

    record.updated_at = new Date().toISOString();
    saveApprovalRecord(an, record);

    res.json({ ok: true, message: `อนุมัติและลงนามเรียบร้อยในบทบาท ${role === 'doctor' ? 'แพทย์' : 'พยาบาล'}`, data: record });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delegate Case to another Doctor or Nurse
app.post('/api/discharge-approval/delegate', async (req, res) => {
  try {
    const { an, target_type, new_target_code, new_target_name, delegated_by_name } = req.body;
    if (!an || !target_type || !new_target_code) {
      return res.status(400).json({ ok: false, error: 'กรุณาระบุข้อมูลการมอบหมายให้ครบถ้วน' });
    }

    let record = getApprovalRecord(an);
    if (!record) {
      const rows = await query(`
        SELECT i.an, i.hn, i.admdoctor, d.name AS doctor_name, d.licenseno
        FROM ipt i
        LEFT JOIN doctor d ON i.admdoctor = d.code
        WHERE i.an = ?
        LIMIT 1
      `, [an]);
      const row = rows[0] || {};
      record = {
        an,
        hn: row.hn || '',
        attending_doctor_code: row.admdoctor || '',
        attending_doctor_name: row.doctor_name || '',
        attending_doctor_license: row.licenseno || '',
        assigned_doctor_code: row.admdoctor || '',
        assigned_doctor_name: row.doctor_name || '',
        assigned_nurse_login: '',
        assigned_nurse_name: '',
        is_doctor_approved: false,
        is_nurse_approved: false,
        doctor_signed_at: null,
        nurse_signed_at: null,
        first_printed_at: null,
        first_printed_by: null,
        is_locked: false,
        delegation_history: [],
      };
    }

    record.delegation_history = record.delegation_history || [];
    if (target_type === 'doctor') {
      record.delegation_history.push({
        type: 'doctor',
        from: record.assigned_doctor_name || record.attending_doctor_name,
        to: new_target_name,
        to_code: new_target_code,
        by: delegated_by_name || 'ผู้ดูแลระบบ',
        at: new Date().toISOString(),
      });
      record.assigned_doctor_code = new_target_code;
      record.assigned_doctor_name = new_target_name;
      record.is_doctor_approved = false;
      record.doctor_signed_at = null;
    } else if (target_type === 'nurse') {
      record.delegation_history.push({
        type: 'nurse',
        from: record.assigned_nurse_name || 'พยาบาลประจำตึก',
        to: new_target_name,
        to_login: new_target_code,
        by: delegated_by_name || 'ผู้ดูแลระบบ',
        at: new Date().toISOString(),
      });
      record.assigned_nurse_login = new_target_code;
      record.assigned_nurse_name = new_target_name;
      record.is_nurse_approved = false;
      record.nurse_signed_at = null;
    }

    record.updated_at = new Date().toISOString();
    saveApprovalRecord(an, record);

    res.json({ ok: true, message: `มอบหมายงานให้ ${new_target_name} เรียบร้อยแล้ว`, data: record });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 1. API: Wards & Statistics
// -------------------------------------------------------------
app.get('/api/wards', async (req, res) => {
  try {
    const wards = await query(`
      SELECT w.ward, w.name, 
             COUNT(i.an) AS active_patients,
             SUM(CASE WHEN p.sex = '1' THEN 1 ELSE 0 END) AS male_count,
             SUM(CASE WHEN p.sex = '2' THEN 1 ELSE 0 END) AS female_count
      FROM ward w
      LEFT JOIN ipt i ON w.ward = i.ward AND i.dchdate IS NULL
      LEFT JOIN patient p ON i.hn = p.hn
      GROUP BY w.ward, w.name
      ORDER BY active_patients DESC, w.ward ASC
    `);
    res.json({ ok: true, data: wards });
  } catch (err) {
    console.error('Error fetching wards:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 2. API: Active IPD Patients List (Bed Board)
// -------------------------------------------------------------
app.get('/api/patients', async (req, res) => {
  try {
    const { ward, search } = req.query;
    let sql = `
      SELECT i.an, i.hn, i.ward, w.name AS ward_name,
             concat(p.pname, p.fname, ' ', p.lname) AS patient_name,
             p.sex, TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
             p.birthday, p.cid, p.drugallergy,
             (
               SELECT GROUP_CONCAT(DISTINCT CONCAT(agent, IF(symptom IS NOT NULL AND symptom != '', CONCAT(' (', symptom, ')'), '')) SEPARATOR ', ')
               FROM opd_allergy 
               WHERE hn = i.hn AND agent IS NOT NULL AND agent != ''
             ) AS opd_allergy_detail,
             i.regdate, i.regtime,
             DATEDIFF(CURDATE(), i.regdate) + 1 AS los_days,
             i.pttype, ptt.name AS pttype_name,
             i.prediag,
             adm.bedno, b.bedname, adm.roomno,
             d.name AS doctor_name, d.code AS doctor_code, d.licenseno AS doctor_licenseno,
             (SELECT count(*) FROM iptdiag WHERE an = i.an) AS diag_count,
             (SELECT count(*) FROM ipd_nurse_note WHERE an = i.an) AS nurse_note_count,
             (SELECT count(*) FROM lab_head WHERE vn = i.an) AS lab_count,
             (
               SELECT json_object(
                 'temp', temperature, 
                 'pulse', pulse, 
                 'rr', respiratory_rate, 
                 'bps', bp_systolic, 
                 'bpd', bp_diastolic, 
                 'spo2', COALESCE(spo2_ra, spo2_o2),
                 'sos', sos_score,
                 'news2', news2_score,
                 'note_datetime', note_datetime,
                 'note_date', note_date,
                 'note_time', note_time
               )
               FROM ipd_nurse_note
               WHERE an = i.an AND (temperature > 0 OR pulse > 0 OR bp_systolic > 0)
               ORDER BY note_date DESC, note_time DESC
               LIMIT 1
             ) AS latest_vitals
      FROM ipt i
      LEFT JOIN patient p ON i.hn = p.hn
      LEFT JOIN ward w ON i.ward = w.ward
      LEFT JOIN pttype ptt ON i.pttype = ptt.pttype
      LEFT JOIN iptadm adm ON i.an = adm.an
      LEFT JOIN bedno b ON adm.bedno = b.bedno
      LEFT JOIN doctor d ON i.admdoctor = d.code
      WHERE i.dchdate IS NULL
    `;
    const params = [];

    if (ward && ward !== 'ALL') {
      sql += ' AND i.ward = ?';
      params.push(ward);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += ' AND (i.an LIKE ? OR i.hn LIKE ? OR p.fname LIKE ? OR p.lname LIKE ? OR adm.bedno LIKE ?)';
      params.push(q, q, q, q, q);
    }

    sql += ' ORDER BY i.ward ASC, adm.bedno ASC, i.regdate DESC';

    const patients = await query(sql, params);

    const parsed = patients.map((p) => {
      let vitals = null;
      if (p.latest_vitals) {
        try {
          vitals = typeof p.latest_vitals === 'string' ? JSON.parse(p.latest_vitals) : p.latest_vitals;
        } catch (e) {
          vitals = null;
        }
      }

      // Prioritize opd_allergy detail if available
      const finalAllergy = p.opd_allergy_detail || p.drugallergy || '';
      const allergyCount = p.opd_allergy_detail ? p.opd_allergy_detail.split(',').length : (p.drugallergy ? 1 : 0);
      const approval = getApprovalRecord(p.an);

      return { 
        ...p, 
        latest_vitals: vitals,
        drugallergy: finalAllergy,
        agent_count: allergyCount,
        assigned_doctor_code: approval?.assigned_doctor_code || p.doctor_code || '',
        assigned_doctor_name: approval?.assigned_doctor_name || p.doctor_name || '',
        assigned_nurse_name: approval?.assigned_nurse_name || '',
        is_doctor_approved: approval?.is_doctor_approved || false,
        is_nurse_approved: approval?.is_nurse_approved || false,
        is_locked: approval?.is_locked || false,
      };
    });

    res.json({ ok: true, data: parsed });
  } catch (err) {
    console.error('Error fetching patients:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3. API: Single Patient Profile Full Detail
// -------------------------------------------------------------
app.get('/api/patient/:an', async (req, res) => {
  try {
    const { an } = req.params;
    const rows = await query(`
      SELECT i.an, i.hn, i.vn, i.ward, w.name AS ward_name,
             concat(p.pname, p.fname, ' ', p.lname) AS patient_name,
             p.pname, p.fname, p.lname,
             p.sex, TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
             p.birthday, p.cid, p.drugallergy, p.bloodgrp, p.bloodgroup_rh,
             (
               SELECT GROUP_CONCAT(DISTINCT CONCAT(agent, IF(symptom IS NOT NULL AND symptom != '', CONCAT(' (', symptom, ')'), '')) SEPARATOR ', ')
               FROM opd_allergy 
               WHERE hn = i.hn AND agent IS NOT NULL AND agent != ''
             ) AS opd_allergy_detail,
             (
               SELECT COUNT(*) 
               FROM opd_allergy 
               WHERE hn = i.hn AND agent IS NOT NULL AND agent != ''
             ) AS agent_count,
             p.informtel, p.informrelation, p.informname,
             i.regdate, i.regtime, i.dchdate, i.dchtime,
             i.dchstts, dch_s.name AS dchstts_name,
             i.dchtype, dch_t.name AS dchtype_name,
             DATEDIFF(COALESCE(i.dchdate, CURDATE()), i.regdate) + 1 AS los_days,
             i.pttype, ptt.name AS pttype_name,
             i.prediag, i.drg, i.rw, i.adjrw,
             adm.bedno, b.bedname, adm.roomno,
             d.name AS doctor_name, d.code AS doctor_code, d.licenseno AS doctor_licenseno,
             i.ipt_type
      FROM ipt i
      LEFT JOIN patient p ON i.hn = p.hn
      LEFT JOIN ward w ON i.ward = w.ward
      LEFT JOIN pttype ptt ON i.pttype = ptt.pttype
      LEFT JOIN iptadm adm ON i.an = adm.an
      LEFT JOIN bedno b ON adm.bedno = b.bedno
      LEFT JOIN doctor d ON i.admdoctor = d.code
      LEFT JOIN dchstts dch_s ON i.dchstts = dch_s.dchstts
      LEFT JOIN dchtype dch_t ON i.dchtype = dch_t.dchtype
      WHERE i.an = ?
      LIMIT 1
    `, [an]);

    const patient = rows[0];
    if (!patient) {
      return res.status(404).json({ ok: false, error: 'Patient not found' });
    }

    // Also get full list from opd_allergy
    const allergies = await query(`
      SELECT agent, symptom, reporter, report_date, relation_level, note
      FROM opd_allergy
      WHERE hn = ? AND agent IS NOT NULL AND agent != ''
      ORDER BY report_date DESC
    `, [patient.hn]);

    patient.opd_allergies = allergies;
    patient.drugallergy = patient.opd_allergy_detail || patient.drugallergy || '';
    const approval = getApprovalRecord(patient.an);
    if (approval) {
      if (approval.dchdate) patient.dchdate = approval.dchdate;
      if (approval.dchtime) patient.dchtime = approval.dchtime;
      if (approval.dchstts_name) patient.dchstts_name = approval.dchstts_name;
      if (approval.dchtype_name) patient.dchtype_name = approval.dchtype_name;
      patient.approval = approval;
    } else {
      patient.approval = {
        an: patient.an,
        hn: patient.hn,
        dchdate: patient.dchdate || '',
        dchtime: patient.dchtime || '',
        dchstts: patient.dchstts || '',
        dchstts_name: patient.dchstts_name || '',
        dchtype: patient.dchtype || '',
        dchtype_name: patient.dchtype_name || '',
        attending_doctor_code: patient.doctor_code || '',
        attending_doctor_name: patient.doctor_name || '',
        attending_doctor_license: patient.doctor_licenseno || '',
        assigned_doctor_code: patient.doctor_code || '',
        assigned_doctor_name: patient.doctor_name || '',
        assigned_nurse_login: '',
        assigned_nurse_name: '',
        is_doctor_approved: false,
        is_nurse_approved: false,
        doctor_signed_at: null,
        nurse_signed_at: null,
        first_printed_at: null,
        first_printed_by: null,
        is_locked: false,
        delegation_history: [],
      };
    }

    res.json({ ok: true, data: patient });
  } catch (err) {
    console.error('Error fetching patient profile:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3.5 API: Case Review & Archive Search (CID / HN / AN / Name)
// -------------------------------------------------------------
app.get('/api/archive/search', async (req, res) => {
  try {
    const { q, ward, date_start, date_end, legacy_filter, limit = 50 } = req.query;
    
    let whereClauses = [];
    let params = [];

    // Search query by CID / HN / AN / Name
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      const cleanTerm = q.trim();
      whereClauses.push(`(
        p.cid LIKE ? OR
        p.hn = ? OR
        p.hn LIKE ? OR
        i.an = ? OR
        i.an LIKE ? OR
        p.fname LIKE ? OR
        p.lname LIKE ? OR
        CONCAT(COALESCE(p.pname,''), COALESCE(p.fname,''), ' ', COALESCE(p.lname,'')) LIKE ?
      )`);
      params.push(term, cleanTerm, term, cleanTerm, term, term, term, term);
    }

    // Ward filter
    if (ward && ward.trim()) {
      whereClauses.push(`i.ward = ?`);
      params.push(ward.trim());
    }

    // Date range filter
    if (date_start) {
      whereClauses.push(`i.regdate >= ?`);
      params.push(date_start);
    }
    if (date_end) {
      whereClauses.push(`i.regdate <= ?`);
      params.push(date_end);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : 'WHERE i.regdate >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)';

    const sql = `
      SELECT i.an, i.hn, p.cid,
             CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS patient_name,
             p.sex, TIMESTAMPDIFF(YEAR, p.birthday, i.regdate) AS age,
             p.informtel,
             i.ward, w.name AS ward_name,
             i.regdate, i.regtime,
             i.dchdate, i.dchtime,
             i.dchstts, dch_s.name AS dchstts_name,
             i.dchtype, dch_t.name AS dchtype_name,
             DATEDIFF(COALESCE(i.dchdate, CURDATE()), i.regdate) + 1 AS los_days,
             i.pttype, ptt.name AS pttype_name,
             i.prediag,
             adm.bedno, b.bedname,
             d.name AS doctor_name, d.code AS doctor_code
      FROM ipt i
      LEFT JOIN patient p ON i.hn = p.hn
      LEFT JOIN ward w ON i.ward = w.ward
      LEFT JOIN pttype ptt ON i.pttype = ptt.pttype
      LEFT JOIN iptadm adm ON i.an = adm.an
      LEFT JOIN bedno b ON adm.bedno = b.bedno
      LEFT JOIN doctor d ON i.admdoctor = d.code
      LEFT JOIN dchstts dch_s ON i.dchstts = dch_s.dchstts
      LEFT JOIN dchtype dch_t ON i.dchtype = dch_t.dchtype
      ${whereSql}
      ORDER BY i.regdate DESC, i.regtime DESC
      LIMIT ?
    `;

    params.push(parseInt(limit, 10) || 50);

    const rows = await query(sql, params);

    // System Go-Live Milestone date: 2026-08-01
    // Any admission/discharge before this without paperless digital snapshot is flagged as legacy data
    const results = rows.map(r => {
      const approval = getApprovalRecord(r.an);
      const isBeforeGoLive = !r.regdate || new Date(r.regdate) < new Date('2026-08-01');
      const isLegacy = isBeforeGoLive || (!approval && r.dchdate && new Date(r.dchdate) < new Date('2026-08-15'));
      
      return {
        ...r,
        is_legacy: isLegacy,
        has_approval: !!approval,
        is_doctor_approved: approval ? approval.is_doctor_approved : false,
        is_nurse_approved: approval ? approval.is_nurse_approved : false,
      };
    });

    if (legacy_filter === 'legacy_only') {
      return res.json({ ok: true, data: results.filter(r => r.is_legacy) });
    } else if (legacy_filter === 'paperless_only') {
      return res.json({ ok: true, data: results.filter(r => !r.is_legacy) });
    }

    res.json({ ok: true, data: results });
  } catch (err) {
    console.error('Error searching archive:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 4. API: Patient Photo
// -------------------------------------------------------------
app.get('/api/patient-photo/:hn', async (req, res) => {
  try {
    const { hn } = req.params;
    const rows = await query(`
      SELECT image FROM patient_image WHERE hn = ? ORDER BY capture_date DESC LIMIT 1
    `, [hn]);

    if (!rows[0] || !rows[0].image) {
      return res.redirect('/images/default-avatar.svg');
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(rows[0].image);
  } catch (err) {
    res.redirect('/images/default-avatar.svg');
  }
});

// -------------------------------------------------------------
// 5. API: Vital Signs & TPR Chart
// -------------------------------------------------------------
app.get('/api/patient/:an/vitals', async (req, res) => {
  try {
    const { an } = req.params;
    const vitals = await query(`
      SELECT nurse_note_id, an, note_date, note_time, note_datetime,
             temperature, pulse, respiratory_rate, bp_systolic, bp_diastolic,
             spo2_ra, spo2_o2, sos_score, news2_score, pain_score, sedation_score,
             fasting_blood_sugar, weight, height, bmi,
             staff, doctor_code, note
      FROM ipd_nurse_note
      WHERE an = ?
      ORDER BY note_date ASC, note_time ASC
    `, [an]);

    res.json({ ok: true, data: vitals });
  } catch (err) {
    console.error('Error fetching vitals:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST: Add Vital Sign (Two-Way HOSxP Sync via `ipd_nurse_note` & `serial`)
app.post('/api/patient/:an/vitals', async (req, res) => {
  try {
    const { an } = req.params;
    const {
      temperature, pulse, respiratory_rate, bp_systolic, bp_diastolic,
      spo2_ra, spo2_o2, pain_score, sos_score, news2_score,
      fbs, weight, height, note, staff
    } = req.body;

    const now = new Date();
    const note_date = now.toISOString().slice(0, 10);
    const note_time = now.toTimeString().slice(0, 8);
    const note_datetime = `${note_date} ${note_time}`;

    const nextId = await getNextHosxpSerial('nurse_note_id', 'ipd_nurse_note', 'nurse_note_id');
    const calcBmi = (weight && height && Number(height) > 0)
      ? (Number(weight) / Math.pow(Number(height) / 100, 2)).toFixed(2)
      : null;

    await pool.query(`
      INSERT INTO ipd_nurse_note (
        nurse_note_id, an, note_date, note_time, note_datetime, entry_datetime,
        temperature, pulse, respiratory_rate, bp_systolic, bp_diastolic,
        spo2_ra, spo2_o2, pain_score, sos_score, news2_score,
        fasting_blood_sugar, weight, height, bmi, note, staff
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nextId, an, note_date, note_time, note_datetime,
      temperature || null, pulse || null, respiratory_rate || null,
      bp_systolic || null, bp_diastolic || null,
      spo2_ra || null, spo2_o2 || null, pain_score || null,
      sos_score || null, news2_score || null,
      fbs || null, weight || null, height || null, calcBmi,
      note || '', staff || 'PAPERLESS_IPD'
    ]);

    res.json({ ok: true, id: nextId, hosxp_synced: true, message: 'บันทึกสัญญาณชีพและซิงค์เข้าฐานข้อมูล HOSxP เรียบร้อย' });
  } catch (err) {
    console.error('Error adding vitals:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6. API: Doctor Orders & Medications (Fixed icode & Usage Text)
// -------------------------------------------------------------
app.get('/api/patient/:an/orders', async (req, res) => {
  try {
    const { an } = req.params;
    
    // Medplan IPD: Joined with drugitems, nondrugitems, drugusage, sp_use
    const orders = await query(`
      SELECT m.med_plan_number, m.an, m.icode,
             COALESCE(d.name, nd.name, m.icode) AS item_name,
             d.strength,
             COALESCE(d.units, nd.unit, '') AS units,
             CASE 
               WHEN d.name IS NOT NULL THEN 'DRUG'
               WHEN nd.name IS NOT NULL THEN 'NONDRUG'
               ELSE 'UNKNOWN'
             END AS item_type,
             m.qty, m.orderdate, m.offdate, m.orderstatus,
             TRIM(CONCAT(
               COALESCE(du.name1, sp.name1, ''), ' ',
               COALESCE(du.name2, sp.name2, ''), ' ',
               COALESCE(du.name3, sp.name3, '')
             )) AS usage_text,
             m.sp_use, m.drugusage,
             m.first_dose_date_time, m.is_stat, m.doctor_note,
             doc.name AS doctor_name
      FROM medplan_ipd m
      LEFT JOIN drugitems d ON m.icode = d.icode
      LEFT JOIN nondrugitems nd ON m.icode = nd.icode
      LEFT JOIN drugusage du ON m.drugusage = du.drugusage
      LEFT JOIN sp_use sp ON m.sp_use = sp.sp_use
      LEFT JOIN doctor doc ON m.doctor = doc.code
      WHERE m.an = ?
      ORDER BY m.orderdate DESC, m.med_plan_number DESC
    `, [an]);

    res.json({ ok: true, orders, data: orders });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Search Drug & Non-drug items
app.get('/api/search-drugs', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ ok: true, data: [] });

    const items = await query(`
      SELECT icode, name, strength, units, 'DRUG' AS item_type, unitprice
      FROM drugitems
      WHERE (name LIKE ? OR icode LIKE ? OR generic_name LIKE ?) AND istatus = 'Y'
      UNION ALL
      SELECT icode, name, '' AS strength, unit AS units, 'NONDRUG' AS item_type, price AS unitprice
      FROM nondrugitems
      WHERE (name LIKE ? OR icode LIKE ?) AND (istatus = 'Y' OR istatus IS NULL)
      ORDER BY name ASC
      LIMIT 30
    `, [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]);

    res.json({ ok: true, data: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST: Add Doctor Order / Medication directly into HOSxP `medplan_ipd`
app.post('/api/patient/:an/orders', async (req, res) => {
  try {
    const { an } = req.params;
    const { icode, qty, usage_text, orderstatus, is_stat, doctor_code, doctor_note, staff } = req.body;
    if (!icode) return res.status(400).json({ ok: false, error: 'กรุณาเลือกรายการยาหรือเวชภัณฑ์' });

    const nextPlanNo = await getNextHosxpSerial('med_plan_number', 'medplan_ipd', 'med_plan_number');
    const ptRows = await query('SELECT admdoctor FROM ipt WHERE an = ? LIMIT 1', [an]);
    const docCode = doctor_code || ptRows[0]?.admdoctor || '2632';

    await pool.query(`
      INSERT INTO medplan_ipd (
        med_plan_number, an, doctor, icode, qty,
        orderdate, orderstatus, usage_line1, usage_shortlist,
        is_stat, doctor_note, staff, first_update, last_update, update_datetime
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
    `, [
      nextPlanNo,
      an,
      docCode,
      icode,
      Number(qty || 1),
      orderstatus || 'C',
      usage_text || '',
      usage_text || '',
      is_stat === 'Y' ? 'Y' : 'N',
      doctor_note || (usage_text || ''),
      (staff || 'PAPERLESS').slice(0, 25),
    ]);

    res.json({
      ok: true,
      id: nextPlanNo,
      hosxp_synced: true,
      message: 'บันทึกคำสั่งการรักษาและซิงค์เข้าตาราง medplan_ipd ใน HOSxP เรียบร้อย',
    });
  } catch (err) {
    console.error('Error adding order:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST: Off / Discontinue Medication Order in HOSxP `medplan_ipd`
app.post('/api/patient/:an/orders/:med_plan_number/off', async (req, res) => {
  try {
    const { an, med_plan_number } = req.params;
    const { staff } = req.body;
    await pool.query(`
      UPDATE medplan_ipd
      SET offdate = NOW(), off_time = CURTIME(), off_staff = ?, last_update = NOW(), update_datetime = NOW()
      WHERE an = ? AND med_plan_number = ?
    `, [(staff || 'PAPERLESS').slice(0, 25), an, med_plan_number]);

    res.json({ ok: true, hosxp_synced: true, message: 'สั่งหยุดยา (Off Order) ในระบบ HOSxP เรียบร้อย' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 7. API: Nurse Notes & Focus Charting (FDAR)
// -------------------------------------------------------------
app.get('/api/patient/:an/nurse-notes', async (req, res) => {
  try {
    const { an } = req.params;
    const notes = await query(`
      SELECT nurse_note_id, an, note_date, note_time, note_datetime,
             note, staff, temperature, pulse, respiratory_rate, bp_systolic, bp_diastolic,
             pain_score, sos_score,
             fluid_intake_oral, fluid_intake_parenteral, fluid_output_urine, fluid_output_emesis
      FROM ipd_nurse_note
      WHERE an = ? AND (note != '' OR note IS NOT NULL)
      ORDER BY note_date DESC, note_time DESC
    `, [an]);

    res.json({ ok: true, data: notes });
  } catch (err) {
    console.error('Error fetching nurse notes:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST: Add Nurse Note (Two-Way HOSxP Sync)
app.post('/api/patient/:an/nurse-notes', async (req, res) => {
  try {
    const { an } = req.params;
    const { note, staff, pain_score, oral_in, iv_in, urine_out, emesis_out } = req.body;

    const now = new Date();
    const note_date = now.toISOString().slice(0, 10);
    const note_time = now.toTimeString().slice(0, 8);
    const note_datetime = `${note_date} ${note_time}`;

    const nextId = await getNextHosxpSerial('nurse_note_id', 'ipd_nurse_note', 'nurse_note_id');

    await pool.query(`
      INSERT INTO ipd_nurse_note (
        nurse_note_id, an, note_date, note_time, note_datetime, entry_datetime,
        note, staff, pain_score,
        fluid_intake_oral, fluid_intake_parenteral, fluid_output_urine, fluid_output_emesis
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)
    `, [
      nextId, an, note_date, note_time, note_datetime,
      note || '', staff || 'พยาบาลผู้บันทึก', pain_score || null,
      oral_in || 0, iv_in || 0, urine_out || 0, emesis_out || 0
    ]);

    res.json({ ok: true, id: nextId, hosxp_synced: true, message: 'บันทึก Nurse Note และซิงค์เข้า HOSxP เรียบร้อย' });
  } catch (err) {
    console.error('Error adding nurse note:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8. API: Laboratory Results
// -------------------------------------------------------------
app.get('/api/patient/:an/labs', async (req, res) => {
  try {
    const { an } = req.params;
    const rows = await query('SELECT hn, regdate FROM ipt WHERE an = ?', [an]);
    const pt = rows[0];
    if (!pt) return res.status(404).json({ ok: false, error: 'Patient not found' });

    const labHeads = await query(`
      SELECT lh.lab_order_number, lh.vn, lh.hn, lh.order_date, lh.order_time,
             lh.report_date, lh.report_time, lh.form_name, lh.confirm_report,
             lh.abnormal_result, lh.reporter_name, d.name AS doctor_name
      FROM lab_head lh
      LEFT JOIN doctor d ON lh.doctor_code = d.code
      WHERE lh.vn = ? OR (lh.hn = ? AND lh.order_date >= ?)
      ORDER BY lh.order_date DESC, lh.order_time DESC
      LIMIT 20
    `, [an, pt.hn, pt.regdate]);

    const fullLabs = await Promise.all(
      labHeads.map(async (lh) => {
        const items = await query(`
          SELECT lo.lab_items_code, lo.lab_items_name_ref, lo.lab_order_result,
                 lo.lab_items_normal_value_ref, lo.abnormal_result, lo.critical_result,
                 lo.lab_order_remark
          FROM lab_order lo
          WHERE lo.lab_order_number = ?
          ORDER BY lo.lab_items_name_ref ASC
        `, [lh.lab_order_number]);

        return { ...lh, items };
      })
    );

    res.json({ ok: true, data: fullLabs });
  } catch (err) {
    console.error('Error fetching labs:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8.1 API: X-Ray & Imaging
// -------------------------------------------------------------
app.get('/api/patient/:an/xrays', async (req, res) => {
  try {
    const { an } = req.params;
    const rows = await query('SELECT hn, regdate FROM ipt WHERE an = ?', [an]);
    const pt = rows[0];
    if (!pt) return res.status(404).json({ ok: false, error: 'Patient not found' });

    const xrays = await query(`
      SELECT x.xray_order_number, x.vn, x.hn, x.order_date, x.order_time,
             x.xray_list, x.confirm_report, x.report_date, x.report_time,
             x.reporter_name, x.result_note, x.department_name,
             d.name AS doctor_name
      FROM xray_head x
      LEFT JOIN doctor d ON x.doctor_code = d.code
      WHERE x.vn = ? OR (x.hn = ? AND x.order_date >= ?)
      ORDER BY x.order_date DESC, x.xray_order_number DESC
      LIMIT 20
    `, [an, pt.hn, pt.regdate]);

    res.json({ ok: true, data: xrays });
  } catch (err) {
    console.error('Error fetching xrays:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8.2 API: Intake / Output Sheet
// -------------------------------------------------------------
app.get('/api/patient/:an/io', async (req, res) => {
  try {
    const { an } = req.params;
    const ioRecords = await query(`
      SELECT nurse_note_id, note_date, note_time, note_datetime, staff,
             COALESCE(fluid_intake_oral, 0) AS oral_in,
             COALESCE(fluid_intake_parenteral, 0) AS parenteral_in,
             (COALESCE(fluid_intake_oral, 0) + COALESCE(fluid_intake_parenteral, 0)) AS total_in,
             COALESCE(fluid_output_urine, 0) AS urine_out,
             COALESCE(fluid_output_emesis, 0) AS emesis_out,
             COALESCE(fluid_output_drainage, 0) AS drainage_out,
             (COALESCE(fluid_output_urine, 0) + COALESCE(fluid_output_emesis, 0) + COALESCE(fluid_output_drainage, 0)) AS total_out,
             note
      FROM ipd_nurse_note
      WHERE an = ? AND (fluid_intake_oral > 0 OR fluid_intake_parenteral > 0 OR fluid_output_urine > 0 OR fluid_output_emesis > 0 OR fluid_output_drainage > 0)
      ORDER BY note_date ASC, note_time ASC
    `, [an]);

    res.json({ ok: true, data: ioRecords });
  } catch (err) {
    console.error('Error fetching I/O records:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8.3 API: Admission Assessment & Physical Examination (PE)
// -------------------------------------------------------------
app.get('/api/patient/:an/admission-assessment', async (req, res) => {
  try {
    const { an } = req.params;
    const rows = await query(`
      SELECT i.an, i.hn, i.vn, i.prediag, i.regdate, i.regtime,
             s.cc, s.hpi, s.pmh, s.fh, s.sh, s.pe, s.pe_ga, s.pe_heent, s.pe_heart, s.pe_lung, s.pe_ab, s.pe_ext, s.pe_neuro,
             s.temperature, s.pulse, s.rr, s.bps, s.bpd, s.height, s.bw, s.bmi,
             p.drugallergy, doc.name AS doctor_name
      FROM ipt i
      LEFT JOIN opdscreen s ON i.vn = s.vn
      LEFT JOIN patient p ON i.hn = p.hn
      LEFT JOIN doctor doc ON i.admdoctor = doc.code
      WHERE i.an = ?
      LIMIT 1
    `, [an]);

    const assess = rows[0] || {};
    res.json({ ok: true, data: assess });
  } catch (err) {
    console.error('Error fetching admission assessment:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/patient/:an/admission-assessment', async (req, res) => {
  try {
    const { an } = req.params;
    const { cc, hpi, pmh, pe_ga, pe_heent, pe_heart, pe_lung, pe_ab, pe_ext, pe_neuro, initial_plan } = req.body;
    
    const rows = await query('SELECT vn FROM ipt WHERE an = ?', [an]);
    const pt = rows[0];
    if (pt && pt.vn) {
      const fullPe = `GA: ${pe_ga || '-'}\nHEENT: ${pe_heent || '-'}\nHeart: ${pe_heart || '-'}\nLung: ${pe_lung || '-'}\nAbd: ${pe_ab || '-'}\nExt: ${pe_ext || '-'}\nNeuro: ${pe_neuro || '-'}`;
      await pool.query(`
        UPDATE opdscreen 
        SET cc = COALESCE(?, cc), hpi = COALESCE(?, hpi), pmh = COALESCE(?, pmh), pe = ?
        WHERE vn = ?
      `, [cc || null, hpi || null, pmh || null, fullPe, pt.vn]);
    }

    // Also sync Chief Complaint / Prediag directly to `ipt.prediag` if provided
    if (cc && cc.trim()) {
      await pool.query(`UPDATE ipt SET prediag = ? WHERE an = ?`, [cc.trim().slice(0, 250), an]);
    }

    res.json({ ok: true, hosxp_synced: true, message: 'บันทึกการประเมินแรกรับและซิงค์เข้าตาราง opdscreen / ipt ใน HOSxP เรียบร้อย' });
  } catch (err) {
    console.error('Error saving admission assessment:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8.4 API: Doctor Progress Notes (SOAP)
// -------------------------------------------------------------
app.get('/api/patient/:an/progress-notes', async (req, res) => {
  try {
    const { an } = req.params;
    const notes = await query(`
      SELECT o.ipd_doctor_order_id, o.an, o.order_date, o.order_time,
             o.pn_s, o.pn_o, o.pn_a, o.pn_p, o.pn_note, o.pn_risk,
             o.doctor_code, d.name AS doctor_name, o.order_approved
      FROM ipd_doctor_order o
      LEFT JOIN doctor d ON o.doctor_code = d.code
      WHERE o.an = ?
      ORDER BY o.order_date DESC, o.order_time DESC
    `, [an]);

    res.json({ ok: true, data: notes });
  } catch (err) {
    console.error('Error fetching progress notes:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/patient/:an/progress-notes', async (req, res) => {
  try {
    const { an } = req.params;
    const { pn_s, pn_o, pn_a, pn_p, doctor_code, doctor_name } = req.body;

    const now = new Date();
    const order_date = now.toISOString().slice(0, 10);
    const order_time = now.toTimeString().slice(0, 8);

    const nextId = await getNextHosxpSerial('ipd_doctor_order_id', 'ipd_doctor_order', 'ipd_doctor_order_id');

    await pool.query(`
      INSERT INTO ipd_doctor_order (
        ipd_doctor_order_id, an, order_date, order_time, doctor_code,
        pn_s, pn_o, pn_a, pn_p, entry_staff, order_approved
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y')
    `, [
      nextId, an, order_date, order_time, doctor_code || '2632',
      pn_s || '', pn_o || '', pn_a || '', pn_p || '',
      (doctor_name || 'แพทย์ผู้ตรวจ').slice(0, 25)
    ]);

    res.json({ ok: true, id: nextId, hosxp_synced: true, message: 'บันทึก Doctor Progress Note (SOAP) และซิงค์เข้า HOSxP เรียบร้อย' });
  } catch (err) {
    console.error('Error adding progress note:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8.5 API: Electronic Medication Administration Record (e-MAR)
// -------------------------------------------------------------
app.get('/api/patient/:an/mar', async (req, res) => {
  try {
    const { an } = req.params;
    const meds = await query(`
      SELECT m.med_plan_number, m.an, m.icode, d.name AS drug_name, d.strength, d.units,
             d.high_cost, d.habit_forming, d.criticalpriority,
             m.qty, m.orderdate, m.offdate, m.orderstatus, m.is_stat,
             TRIM(CONCAT(COALESCE(du.name1, sp.name1, m.usage_line1, ''), ' ', COALESCE(du.name2, sp.name2, ''), ' ', COALESCE(du.name3, sp.name3, ''))) AS usage_text,
             doc.name AS doctor_name
      FROM medplan_ipd m
      JOIN drugitems d ON m.icode = d.icode
      LEFT JOIN drugusage du ON m.drugusage = du.drugusage
      LEFT JOIN sp_use sp ON m.sp_use = sp.sp_use
      LEFT JOIN doctor doc ON m.doctor = doc.code
      WHERE m.an = ?
      ORDER BY m.offdate ASC, m.is_stat DESC, m.orderdate DESC
    `, [an]);

    res.json({ ok: true, data: meds });
  } catch (err) {
    console.error('Error fetching MAR:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST: Record e-MAR Administration / Hold into HOSxP `ipd_nurse_note`
app.post('/api/patient/:an/mar/record', async (req, res) => {
  try {
    const { an } = req.params;
    const { drug_name, action, reason, staff } = req.body;
    const now = new Date();
    const note_date = now.toISOString().slice(0, 10);
    const note_time = now.toTimeString().slice(0, 8);
    const note_datetime = `${note_date} ${note_time}`;

    const nextId = await getNextHosxpSerial('nurse_note_id', 'ipd_nurse_note', 'nurse_note_id');
    const marNote = action === 'HOLD'
      ? `[e-MAR HOLD] งดให้ยาชั่วคราว: ${drug_name || '-'} | เหตุผล: ${reason || 'ตามดุลยพินิจทางคลินิก'}`
      : `[e-MAR GIVEN] บริหารยาเรียบร้อย: ${drug_name || '-'} (ตรวจสอบหลัก 5R ครบถ้วน)`;

    await pool.query(`
      INSERT INTO ipd_nurse_note (
        nurse_note_id, an, note_date, note_time, note_datetime, entry_datetime,
        note, staff
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)
    `, [nextId, an, note_date, note_time, note_datetime, marNote, (staff || 'พยาบาลประจำตึก').slice(0, 25)]);

    res.json({ ok: true, id: nextId, hosxp_synced: true, message: marNote });
  } catch (err) {
    console.error('Error recording MAR action:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8.6 API: Full Discharge Summary & MRA Audit Sheet
// -------------------------------------------------------------
app.get('/api/patient/:an/discharge-summary', async (req, res) => {
  try {
    const { an } = req.params;
    const [ptRows, diags, meds, vitals, labs, xrays, pnotes] = await Promise.all([
      query(`
        SELECT i.an, i.hn, i.vn, i.regdate, i.regtime, i.dchdate, i.dchtime,
               DATEDIFF(COALESCE(i.dchdate, CURDATE()), i.regdate) + 1 AS los_days,
               i.prediag, i.drg, i.rw, i.adjrw, i.dchstts, i.dchtype,
               concat(p.pname, p.fname, ' ', p.lname) AS patient_name,
               p.sex, TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age,
               p.birthday, p.cid, p.drugallergy, p.bloodgrp, p.bloodgroup_rh,
               w.name AS ward_name, adm.bedno, doc.name AS doctor_name,
               dch_stt.name AS dchstts_name, dch_typ.name AS dchtype_name
        FROM ipt i
        LEFT JOIN patient p ON i.hn = p.hn
        LEFT JOIN ward w ON i.ward = w.ward
        LEFT JOIN iptadm adm ON i.an = adm.an
        LEFT JOIN doctor doc ON i.admdoctor = doc.code
        LEFT JOIN dchstts dch_stt ON i.dchstts = dch_stt.dchstts
        LEFT JOIN dchtype dch_typ ON i.dchtype = dch_typ.dchtype
        WHERE i.an = ?
      `, [an]),
      query(`
        SELECT d.diagtype, d.icd10, i.name AS icd_name, doc.name AS doctor_name
        FROM iptdiag d
        LEFT JOIN icd101 i ON d.icd10 = i.code
        LEFT JOIN doctor doc ON d.doctor = doc.code
        WHERE d.an = ?
        ORDER BY d.diagtype ASC
      `, [an]),
      query(`
        SELECT m.icode, d.name AS drug_name, d.strength, m.qty, d.units,
               TRIM(CONCAT(COALESCE(du.name1, ''), ' ', COALESCE(du.name2, ''), ' ', COALESCE(du.name3, ''))) AS usage_text
        FROM medplan_ipd m
        JOIN drugitems d ON m.icode = d.icode
        LEFT JOIN drugusage du ON m.drugusage = du.drugusage
        WHERE m.an = ? AND m.offdate IS NULL
      `, [an]),
      query(`
        SELECT temperature, pulse, respiratory_rate, bp_systolic, bp_diastolic, spo2_ra, note_date, note_time
        FROM ipd_nurse_note
        WHERE an = ? AND (temperature > 0 OR pulse > 0)
        ORDER BY note_date DESC, note_time DESC LIMIT 1
      `, [an]),
      query(`
        SELECT count(*) AS total_labs, sum(case when lo.abnormal_result = 'Y' then 1 else 0 end) as abnormal_labs
        FROM lab_head lh
        LEFT JOIN lab_order lo ON lh.lab_order_number = lo.lab_order_number
        WHERE lh.vn = (SELECT vn FROM ipt WHERE an = ?)
      `, [an]),
      query(`
        SELECT xray_list, confirm_report, result_note FROM xray_head WHERE vn = (SELECT vn FROM ipt WHERE an = ?)
      `, [an]),
      query(`
        SELECT count(*) AS total_progress_notes FROM ipd_doctor_order WHERE an = ?
      `, [an])
    ]);

    const patient = ptRows[0];
    if (!patient) return res.status(404).json({ ok: false, error: 'Patient not found' });

    // Calculate MRA Quality Scorecard (100 pts)
    let scoreAdmission = patient.prediag ? 20 : 10;
    let scoreProgress = (pnotes[0] && pnotes[0].total_progress_notes > 0) ? 20 : 10;
    let scoreOrders = meds.length > 0 ? 15 : 10;
    let scoreNurse = vitals.length > 0 ? 20 : 10;
    let scoreInvestigation = (labs[0] && labs[0].total_labs > 0) ? 10 : 5;
    let scoreDiagnosis = diags.some(d => d.diagtype === '1') ? 15 : 5;
    let totalMraScore = scoreAdmission + scoreProgress + scoreOrders + scoreNurse + scoreInvestigation + scoreDiagnosis;

    res.json({
      ok: true,
      data: {
        patient,
        diagnoses: diags,
        home_medications: meds,
        latest_vitals: vitals[0] || null,
        lab_summary: labs[0] || { total_labs: 0, abnormal_labs: 0 },
        xrays,
        mra_scorecard: {
          score_admission: scoreAdmission,
          score_progress: scoreProgress,
          score_orders: scoreOrders,
          score_nurse: scoreNurse,
          score_investigation: scoreInvestigation,
          score_diagnosis: scoreDiagnosis,
          total_score: totalMraScore,
          is_audit_pass: totalMraScore >= 80,
        }
      }
    });
  } catch (err) {
    console.error('Error generating discharge summary:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 9. API: Diagnoses (ICD-10) with Clean Thai Mapping
// -------------------------------------------------------------
const DIAG_TYPE_MAP = {
  '1': 'Principal Diagnosis (โรคหลัก)',
  '2': 'Comorbidity (โรคร่วม)',
  '3': 'Complication (โรคแทรก)',
  '4': 'Other Diagnosis (โรคอื่นๆ)',
  '5': 'External Cause (สาเหตุภายนอก)',
};

app.get('/api/patient/:an/diagnosis', async (req, res) => {
  try {
    const { an } = req.params;
    const diags = await query(`
      SELECT d.ipt_diag_id, d.an, d.diagtype, d.icd10,
             COALESCE(i.name, d.diagnosis_note) AS icd_name,
             i.tname AS icd_tname,
             d.diagnosis_note, d.entry_datetime, d.doctor, doc.name AS doctor_name
      FROM iptdiag d
      LEFT JOIN icd101 i ON d.icd10 = i.code
      LEFT JOIN doctor doc ON d.doctor = doc.code
      WHERE d.an = ?
      ORDER BY d.diagtype ASC, d.diag_no ASC, d.ipt_diag_id ASC
    `, [an]);

    const mapped = diags.map(d => ({
      ...d,
      diagtype_name: DIAG_TYPE_MAP[d.diagtype] || `Diag Type ${d.diagtype}`,
    }));

    res.json({ ok: true, data: mapped });
  } catch (err) {
    console.error('Error fetching diagnosis:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Search ICD-10 Master Table (`icd101`) in HOSxP
app.get('/api/search-icd10', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || String(q).trim().length < 2) {
      return res.json({ ok: true, data: [] });
    }
    const cleanQ = String(q).trim();
    const rows = await query(`
      SELECT code, name, tname
      FROM icd101
      WHERE (code LIKE ? OR name LIKE ? OR tname LIKE ?)
        AND (active_status = 'Y' OR active_status IS NULL OR active_status = '')
      ORDER BY
        CASE WHEN code LIKE ? THEN 0 ELSE 1 END,
        code ASC
      LIMIT 25
    `, [`%${cleanQ}%`, `%${cleanQ}%`, `%${cleanQ}%`, `${cleanQ}%`]);

    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST: Add or Update ICD-10 Diagnosis directly into HOSxP `iptdiag`
app.post('/api/patient/:an/diagnosis', async (req, res) => {
  try {
    const { an } = req.params;
    const { icd10, diagtype, diagnosis_note, doctor_code, staff } = req.body;
    if (!icd10) return res.status(400).json({ ok: false, error: 'กรุณาระบุรหัสโรค ICD-10' });

    const cleanIcd = String(icd10).trim().toUpperCase().replace(/\./g, '');
    const cleanType = String(diagtype || '1').trim();

    const ptRows = await query('SELECT hn, admdoctor, prediag FROM ipt WHERE an = ? LIMIT 1', [an]);
    const pt = ptRows[0] || {};
    const docCode = doctor_code || pt.admdoctor || '2632';

    const nextId = await getNextHosxpSerial('ipt_diag_id', 'iptdiag', 'ipt_diag_id');
    const [countRows] = await pool.query('SELECT COALESCE(MAX(diag_no), 0) + 1 AS next_no FROM iptdiag WHERE an = ?', [an]);
    const nextDiagNo = countRows[0]?.next_no || 1;

    await pool.query(`
      INSERT INTO iptdiag (
        ipt_diag_id, an, hn, diagtype, doctor, icd10,
        staff, entry_datetime, modify_datetime, diagnosis_note, diag_no
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
    `, [
      nextId,
      an,
      pt.hn || null,
      cleanType,
      docCode,
      cleanIcd,
      (staff || 'PAPERLESS').slice(0, 25),
      diagnosis_note ? String(diagnosis_note).slice(0, 250) : null,
      nextDiagNo,
    ]);

    // If Principal Diagnosis (Type 1) is added and ipt.prediag is empty, sync it to ipt.prediag
    if (cleanType === '1') {
      const icdRows = await query('SELECT name, tname FROM icd101 WHERE code = ? LIMIT 1', [cleanIcd]);
      const diagTitle = diagnosis_note || icdRows[0]?.name || cleanIcd;
      if (!pt.prediag) {
        await pool.query('UPDATE ipt SET prediag = ? WHERE an = ?', [`${cleanIcd}: ${diagTitle}`.slice(0, 250), an]);
      }
    }

    res.json({
      ok: true,
      id: nextId,
      hosxp_synced: true,
      message: `บันทึกรหัสวินิจฉัย ${cleanIcd} เข้าตาราง iptdiag ใน HOSxP เรียบร้อย`,
    });
  } catch (err) {
    console.error('Error saving diagnosis:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE: Remove ICD-10 Diagnosis from HOSxP `iptdiag`
app.delete('/api/patient/:an/diagnosis/:ipt_diag_id', async (req, res) => {
  try {
    const { an, ipt_diag_id } = req.params;
    await pool.query('DELETE FROM iptdiag WHERE an = ? AND ipt_diag_id = ?', [an, ipt_diag_id]);
    res.json({ ok: true, hosxp_synced: true, message: 'ลบรายการวินิจฉัยออกจากตาราง iptdiag ใน HOSxP เรียบร้อย' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 10. API: Medical Record Audit & Vale Guidelines (D:\myvale)
// -------------------------------------------------------------
const VALE_DIR = fs.existsSync(path.join(__dirname, 'data', 'sources'))
  ? path.join(__dirname, 'data', 'sources')
  : (fs.existsSync('D:\\myvale\\myVale\\sources') ? 'D:\\myvale\\myVale\\sources' : path.join(__dirname, 'guides'));

const GUIDE_TITLES = {
  "00Concept": "ภาพรวมและแนวคิดการบันทึกเวชระเบียน (Concept & Overview)",
  "00MedicalRecord": "การสรุปเวชระเบียนและระบบ DRGs (Medical Record & Reimbursement)",
  "01Infection01": "โรคติดเชื้อและ Sepsis ตอนที่ 1 (Infectious Diseases & Sepsis I)",
  "02Infection02": "โรคติดเชื้อ ตอนที่ 2 (Infectious Diseases II)",
  "03Neoplasm": "โรคมะเร็งและเนื้องอก (Neoplasms & Oncology)",
  "04Hematology": "โรคระบบเลือดและโลหิตวิทยา (Hematology & Anemia)",
  "05EndoGland": "โรคต่อมไร้ท่อและไทรอยด์ (Endocrine Glands & Thyroid)",
  "05EndoMetabolism": "โรคเบาหวานและความผิดปกติของเมตาบอลิซึม (Diabetes & Metabolism)",
  "06Behaviour": "จิตเวชและพฤติกรรม (Psychiatry & Behaviour)",
  "07ENT_Ear": "โรคหู คอ จมูก - โรคหู (ENT: Ear Diseases)",
  "07ENT_NT": "โรคหู คอ จมูก - จมูกและคอ (ENT: Nose & Throat)",
  "07Eye": "โรคตาและจักษุวิทยา (Ophthalmology & Eye)",
  "08BrainStroke": "โรคหลอดเลือดสมองและระบบประสาท (Stroke & Neurology)",
  "08BrainSurgery": "ศัลยกรรมระบบประสาทและสมอง (Neurosurgery)",
  "09Coronary": "โรคหลอดเลือดหัวใจโคโรนารี (Coronary Artery Disease / STEMI)",
  "09Heart": "โรคหัวใจและภาวะหัวใจล้มเหลว (Heart Failure & Cardiology)",
  "09HeartCVT": "ศัลยกรรมหัวใจและทรวงอก (Cardiovascular & Thoracic Surgery)",
  "09Vascular": "โรคหลอดเลือดส่วนปลายและหลอดเลือดใหญ่ (Vascular Diseases)",
  "10Pulmonary": "โรคระบบทางเดินหายใจและปอดอักเสบ (Pulmonary & Pneumonia)",
  "11GI1Upper": "โรคระบบทางเดินอาหารส่วนบน (Upper GI & Bleeding)",
  "11GI3AppHer": "ไส้ติ่งอักเสบและไส้เลื่อน (Appendicitis & Hernia)",
  "11GI5Biliary": "โรคตับ ถุงน้ำดี และตับอ่อน (Hepatobiliary & Pancreas)",
  "12SkinSoftTissue": "โรคผิวหนังและเนื้อเยื่ออ่อน (Skin & Soft Tissue Infections)",
  "13Orthopedics": "โรคกระดูก ข้อ และข้ออักเสบ (Orthopedics & Joint)",
  "14Nephroloy": "โรคไตและไตวาย (Nephrology & Renal Failure)",
  "14Urology": "ระบบทางเดินปัสสาวะ (Urology & Stones)",
  "15Obstetrics": "สูติศาสตร์และการคลอด (Obstetrics & Delivery)",
  "16Perinatal": "ทารกแรกเกิดและภาวะปริกำเนิด (Perinatal & Newborn)",
  "19Injury": "การบาดเจ็บและอุบัติเหตุ (Trauma & Injury Coding)",
  "21 Z": "การดูแลสุขภาพและรหัส Z (Health Factors & Z-Codes)",
  "MRA": "คู่มือการตรวจสอบเวชระเบียนฉบับสมบูรณ์ (Complete MRA Standard 2026)",
  "SACA2026": "เกณฑ์มาตรฐานความสมบูรณ์เวชระเบียน SACA 2026",
};

app.get('/api/audit-guides', (req, res) => {
  try {
    if (!fs.existsSync(VALE_DIR)) {
      return res.json({ ok: true, data: [] });
    }
    // Filter to canonical 2026_*.md files to avoid duplicates
    let files = fs.readdirSync(VALE_DIR).filter(f => f.endsWith('.md') && f.startsWith('2026_'));
    if (files.length === 0) {
      files = fs.readdirSync(VALE_DIR).filter(f => f.endsWith('.md'));
    }
    const guides = files.map(filename => {
      const cleanKey = filename.replace(/\.md$/, '').replace(/^2026_/, '').replace(/^CIA_/, '');
      const thaiTitle = GUIDE_TITLES[cleanKey] || cleanKey;
      return {
        id: filename,
        filename,
        title: thaiTitle,
        category: 'เกณฑ์มาตรฐานเวชระเบียน MRA 2026',
      };
    });
    res.json({ ok: true, data: guides });
  } catch (err) {
    console.error('Error reading vale guides:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/audit-guides/:id', (req, res) => {
  try {
    const { id } = req.params;
    const safeFile = path.basename(id);
    const filePath = path.join(VALE_DIR, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'Guide not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ ok: true, filename: safeFile, content });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 11. API: Server Health & Status
// -------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const rows = await query('SELECT NOW() AS server_time, VERSION() as db_version');
    res.json({
      ok: true,
      status: 'UP',
      time: rows[0] ? rows[0].server_time : null,
      db_version: rows[0] ? rows[0].db_version : null,
      port: PORT,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Fallback for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🏥 IPD Paperless Server is running on port ${PORT}`);
  console.log(`🌐 Local Access: http://localhost:${PORT}`);
  console.log(`🔗 Network Access: http://0.0.0.0:${PORT}`);
  console.log(`====================================================`);
});
