const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ============================================================
// 🔒 FILE ENCRYPTION / DECRYPTION
// ============================================================
// ACTIVE — used in arbitrationFile.routes.js
// All uploaded files are encrypted with AES-256-GCM before saving to disk.
// Encrypted format: [iv(16 bytes)][authTag(16 bytes)][encryptedData]
//
// Setup: generate key once and add to .env:
//   node -e "require('crypto').randomBytes(32).toString('hex')"
//   FILE_ENCRYPTION_KEY=<your_64_char_hex_key>

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.FILE_ENCRYPTION_KEY
  ? Buffer.from(process.env.FILE_ENCRYPTION_KEY, 'hex')
  : crypto.randomBytes(32);

if (!process.env.FILE_ENCRYPTION_KEY) {
  console.warn('[security.js] WARNING: FILE_ENCRYPTION_KEY not set in .env — using a random key. Files will be unreadable after server restart!');
}

const encryptFile = (fileBuffer) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
};

const decryptFile = (encryptedBuffer) => {
  const iv = encryptedBuffer.slice(0, 16);
  const authTag = encryptedBuffer.slice(16, 32);
  const encryptedData = encryptedBuffer.slice(32);
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
};

const readAndDecryptFile = (filePath) => {
  const encryptedBuffer = fs.readFileSync(filePath);
  return decryptFile(encryptedBuffer);
};

const encryptUploadedFile = (req, res, next) => {
  if (!req.file || !req.file.buffer) return next();
  try {
    req.file.buffer = encryptFile(req.file.buffer);
    req.file.encrypted = true;
    next();
  } catch (err) {
    console.error('[security.js] File encryption error:', err);
    return res.status(500).json({ message: 'File encryption failed' });
  }
};


// ============================================================
// 🚫 FILE TYPE VALIDATOR
// ============================================================
// ACTIVE — used in arbitrationFile.routes.js

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

const MIME_EXT_MAP = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': ['.txt'],
};

const DANGEROUS_EXTENSIONS = [
  '.exe', '.sh', '.bat', '.cmd', '.js', '.php',
  '.py', '.rb', '.ps1', '.vbs', '.jar', '.msi',
];

const validateFileType = (req, res, next) => {
  if (!req.file) return next();
  if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
    return res.status(400).json({
      message: 'File type not allowed. Allowed: PDF, images, Word, Excel, Text.',
    });
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    return res.status(400).json({ message: 'File extension not allowed.' });
  }
  const allowedExts = MIME_EXT_MAP[req.file.mimetype] || [];
  if (allowedExts.length > 0 && !allowedExts.includes(ext)) {
    return res.status(400).json({ message: 'File extension does not match its content type. Upload rejected.' });
  }
  next();
};


// ============================================================
// 🔐 LOGIN RATE LIMITER
// ============================================================
// NOT ACTIVE — for future use only
// To enable: import loginRateLimiter in auth.routes.js
//   router.post('/jwt', loginRateLimiter, handler)

const loginAttempts = new Map();
const LOGIN_RATE_LIMIT = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockDurationMs: 30 * 60 * 1000,
};

const loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const email = req.body && req.body.email ? req.body.email : 'unknown';
  const key = ip + ':' + email;
  const now = Date.now();
  let record = loginAttempts.get(key);
  if (record) {
    if (record.blockedUntil && now < record.blockedUntil) {
      const minutesLeft = Math.ceil((record.blockedUntil - now) / 60000);
      return res.status(429).json({
        success: false,
        message: 'Too many login attempts. Try again in ' + minutesLeft + ' minute(s).',
        retryAfter: record.blockedUntil,
      });
    }
    if (now - record.firstAttempt > LOGIN_RATE_LIMIT.windowMs) {
      loginAttempts.delete(key);
      record = null;
    }
  }
  if (!record) {
    loginAttempts.set(key, { count: 0, firstAttempt: now, blockedUntil: null });
    record = loginAttempts.get(key);
  }
  record.count++;
  if (record.count > LOGIN_RATE_LIMIT.maxAttempts) {
    record.blockedUntil = now + LOGIN_RATE_LIMIT.blockDurationMs;
    loginAttempts.set(key, record);
    return res.status(429).json({
      success: false,
      message: 'Too many login attempts. Blocked for 30 minutes.',
      retryAfter: record.blockedUntil,
    });
  }
  req.resetLoginAttempts = function() { loginAttempts.delete(key); };
  req.loginAttemptsRemaining = LOGIN_RATE_LIMIT.maxAttempts - record.count;
  res.setHeader('X-RateLimit-Remaining', req.loginAttemptsRemaining);
  next();
};


// ============================================================
// 🚦 API RATE LIMITER
// ============================================================
// NOT ACTIVE — for future use only
// To enable: add in index.js before routes
//   app.use(apiRateLimiter)

const apiRequestCounts = new Map();
const API_RATE_LIMIT = { maxRequests: 100, windowMs: 60 * 1000 };

const apiRateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  let record = apiRequestCounts.get(ip);
  if (!record || now - record.firstRequest > API_RATE_LIMIT.windowMs) {
    apiRequestCounts.set(ip, { count: 1, firstRequest: now });
    return next();
  }
  record.count++;
  if (record.count > API_RATE_LIMIT.maxRequests) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please slow down.' });
  }
  next();
};


// ============================================================
// 🛡️ SECURITY HEADERS
// ============================================================
// NOT ACTIVE — for future use only
// To enable: add in index.js before routes
//   app.use(securityHeaders)

const securityHeaders = (req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' blob: data: https:",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    "object-src 'self' blob:",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; '));
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  res.removeHeader('X-Powered-By');
  next();
};


// ============================================================
// 🧹 INPUT SANITIZER
// ============================================================
// NOT ACTIVE — for future use only
// To enable: add in index.js after express.json()
//   app.use(sanitizeInput)
// Note: automatically skips /payment/* for SSLCommerz callbacks

const SANITIZE_SKIP_PATHS = ['/payment/success', '/payment/fail', '/payment/cancel', '/ipn'];

const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /<[^>]+on\w+\s*=\s*["'][^"']*["'][^>]*>/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /<iframe[\s\S]*?>/gi,
  /eval\s*\(/gi,
  /expression\s*\(/gi,
];

const stripXss = (value) => {
  if (typeof value !== 'string') return value;
  let clean = value;
  for (const pattern of XSS_PATTERNS) clean = clean.replace(pattern, '');
  return clean.trim();
};

const sanitizeInput = (req, res, next) => {
  const skip = SANITIZE_SKIP_PATHS.some(function(p) { return req.path.startsWith(p); });
  if (skip) return next();
  const sanitize = (obj) => {
    if (typeof obj === 'string') return stripXss(obj);
    if (typeof obj !== 'object' || obj === null) return obj;
    const dangerous = ['__proto__', 'constructor', 'prototype'];
    dangerous.forEach(function(k) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) delete obj[k];
    });
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) { delete obj[key]; continue; }
      if (dangerous.includes(key)) { delete obj[key]; continue; }
      obj[key] = sanitize(obj[key]);
    }
    return obj;
  };
  req.body   = sanitize(req.body);
  req.query  = sanitize(req.query);
  req.params = sanitize(req.params);
  next();
};


// ============================================================
// ♻️ CLEANUP — stale rate limit entries (runs every 10 min)
// ============================================================

setInterval(function() {
  const now = Date.now();
  for (const [key, record] of loginAttempts.entries()) {
    if (now - record.firstAttempt > LOGIN_RATE_LIMIT.windowMs &&
        (!record.blockedUntil || now > record.blockedUntil)) {
      loginAttempts.delete(key);
    }
  }
  for (const [key, record] of apiRequestCounts.entries()) {
    if (now - record.firstRequest > API_RATE_LIMIT.windowMs) {
      apiRequestCounts.delete(key);
    }
  }
}, 10 * 60 * 1000);


// ============================================================
// 📦 EXPORTS
// ============================================================

module.exports = {
  // ACTIVE — file system security
  encryptFile,
  decryptFile,
  readAndDecryptFile,
  encryptUploadedFile,
  validateFileType,
  // NOT ACTIVE — available for future use
  loginRateLimiter,
  apiRateLimiter,
  securityHeaders,
  sanitizeInput,
};