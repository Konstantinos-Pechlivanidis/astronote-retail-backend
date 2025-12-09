// apps/api/src/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');

// ---- Create app ----
const app = express();

// If behind reverse proxy (Render/NGINX), trust X-Forwarded-* for real IPs
app.set('trust proxy', true);

// ---- Logging (per-request) ----
app.use(
  pinoHttp({
    genReqId: (req, _res) =>
      req.headers['x-request-id'] ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    autoLogging: true,
    customSuccessMessage: function (req, res) {
      return `${req.method} ${req.url} -> ${res.statusCode}`;
    },
    customErrorMessage: function (req, res, err) {
      return `error on ${req.method} ${req.url}: ${err.message}`;
    },
  })
);

// ---- Security headers ----
app.use(
  helmet({
    // Adjust only if you serve images/assets cross-origin
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ---- CORS (allowlist from env) ----
const allowlist = (process.env.CORS_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Add default retail frontend URL if not in allowlist
const defaultRetailFrontend = 'https://astronote-retail-frontend.onrender.com';
if (!allowlist.includes(defaultRetailFrontend) && !allowlist.some(a => defaultRetailFrontend.startsWith(a))) {
  allowlist.push(defaultRetailFrontend);
}

// Allow Postman / server-to-server (no Origin)
const corsOptions = allowlist.length
  ? {
      origin(origin, cb) {
        // Allow requests with no origin (e.g., Postman, server-to-server)
        if (!origin) {
          return cb(null, true);
        }
        
        // Check if origin matches any allowlist entry (exact match or starts with)
        const ok = allowlist.some((allowed) => {
          // Exact match
          if (origin === allowed) {
            return true;
          }
          // Starts with match (for subpaths)
          if (origin.startsWith(allowed)) {
            return true;
          }
          // Handle protocol variations
          const originWithoutProtocol = origin.replace(/^https?:\/\//, '');
          const allowedWithoutProtocol = allowed.replace(/^https?:\/\//, '');
          if (originWithoutProtocol === allowedWithoutProtocol || originWithoutProtocol.startsWith(allowedWithoutProtocol)) {
            return true;
          }
          return false;
        });
        
        if (!ok) {
          // Log for debugging (only in development)
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`[CORS] Blocked origin: ${origin}. Allowed: ${allowlist.join(', ')}`);
          }
        }
        
        return cb(ok ? null : new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
      maxAge: 86400, // 24 hours
    }
  : { 
      origin: true, 
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
    };

app.use(cors(corsOptions));

// Explicit OPTIONS handler for preflight requests (ensure CORS works)
app.options('*', cors(corsOptions));

// ---- Body parsers ----
// Keep a raw copy for HMAC verification on webhooks
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ---- Health route (no auth) ----
app.use(require('./routes/health'));

// ---- Public landing (simple) ----
app.get('/', (_req, res) => res.json({ status: 'api-ok' }));

// ========= ROUTES MOUNTING =========
// Suggest grouping under /api; keep /tracking public

// Public NFC endpoints (before auth)
app.use('/nfc', require('./routes/nfc'));

// Public conversion endpoints (before auth)
app.use('/api/conversion', require('./routes/conversion'));

// Auth (login/register/refresh)
app.use('/api', require('./routes/auth'));

// Me - Get current user with credits
const requireAuth = require('./middleware/requireAuth');
app.get('/api/me', requireAuth, async (req, res, next) => {
  // Don't process if response already sent (e.g., by middleware)
  if (res.headersSent) {
    return;
  }

  try {
    // Safety check (should never happen if middleware works correctly)
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    const prisma = require('./lib/prisma');
    const { getBalance } = require('./services/wallet.service');
    
    // Ensure userId is a number
    const userId = typeof req.user.id === 'string' ? parseInt(req.user.id, 10) : req.user.id;
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    
    // Fetch full user from database
    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          senderName: true,
          company: true,
          timezone: true
        }
      });
    } catch (dbError) {
      const logger = require('pino')({ name: 'server' });
      logger.error({ err: dbError, userId }, 'Database error in /api/me');
      const err = new Error('Database error');
      err.status = 500;
      return next(err);
    }
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get wallet balance (wrap in try-catch for better error handling)
    let credits = 0;
    try {
      credits = await getBalance(userId);
    } catch (walletError) {
      // Log wallet error but don't fail the request - return 0 credits
      if (req.log) {
        req.log.warn({ err: walletError, userId }, 'Error fetching wallet balance, defaulting to 0');
      } else {
        const logger = require('pino')({ name: 'server' });
        logger.warn({ err: walletError, userId }, 'Error fetching wallet balance, defaulting to 0');
      }
      credits = 0;
    }
    
    // Ensure response hasn't been sent
    if (!res.headersSent) {
      res.json({
        user: {
          ...user,
          credits
        }
      });
    }
  } catch (e) {
    // Ensure error has a message for proper handling
    if (!e.message) {
      e.message = e.toString() || 'Internal Server Error';
    }
    // Log the actual error for debugging
    if (req.log) {
      req.log.error({ err: e, userId: req.user?.id }, 'Error in /api/me');
    } else {
      const logger = require('pino')({ name: 'server' });
      logger.error({ err: e, userId: req.user?.id }, 'Error in /api/me');
    }
    
    // Only call next if response hasn't been sent
    if (!res.headersSent) {
      next(e);
    }
  }
});

// Contacts & Lists
app.use('/api', require('./routes/contacts'));
app.use('/api', require('./routes/lists'));

// Templates (system + owner)
app.use('/api', require('./routes/templates'));

// Automations (system-defined, user can enable/disable and edit)
app.use('/api', require('./routes/automations'));

// Campaigns (CRUD, preview, enqueue, schedule)
app.use('/api', require('./routes/campaigns'));

// Campaigns stats & list (versioned)
app.use('/api/v1', require('./routes/campaigns.stats'));
app.use('/api/v1', require('./routes/campaigns.list'));

// Billing (wallet, packages, purchases)
app.use('/api', require('./routes/billing'));

// Dashboard (KPIs)
app.use('/api', require('./routes/dashboard'));

// Queue/Jobs health
app.use('/api', require('./routes/jobs'));

// Mitto API endpoints (status refresh, message lookup)
app.use('/api', require('./routes/mitto'));

// Webhooks (Mitto) — must come after rawBody middleware
app.use(require('./routes/mitto.webhooks'));

// Webhooks (Stripe) — must come after rawBody middleware
app.use(require('./routes/stripe.webhooks'));

// Public tracking endpoints (QR redeem check etc.)
app.use('/tracking', require('./routes/tracking'));

// /docs and /openapi.json
app.use(require('./routes/docs')); 

// ========= ERROR HANDLERS =========

// 404 for unknown API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/tracking')) {
    return res.status(404).json({ 
      message: 'Endpoint not found', 
      code: 'RESOURCE_NOT_FOUND' 
    });
  }
  return next();
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // Ensure CORS headers are set even on error responses
  const origin = req.headers.origin;
  if (origin && allowlist.length) {
    const isAllowed = allowlist.some((allowed) => {
      if (origin === allowed || origin.startsWith(allowed)) {
        return true;
      }
      const originWithoutProtocol = origin.replace(/^https?:\/\//, '');
      const allowedWithoutProtocol = allowed.replace(/^https?:\/\//, '');
      return originWithoutProtocol === allowedWithoutProtocol || originWithoutProtocol.startsWith(allowedWithoutProtocol);
    });
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  
  const { handleError } = require('./lib/errors');
  handleError(err, req, res);
});

// ========= SETUP STATUS REFRESH SCHEDULER =========
const STATUS_REFRESH_ENABLED = process.env.STATUS_REFRESH_ENABLED !== '0'; // Default: enabled
const STATUS_REFRESH_INTERVAL = Number(process.env.STATUS_REFRESH_INTERVAL || 600000); // Default: 10 minutes (600000ms)

if (STATUS_REFRESH_ENABLED && process.env.QUEUE_DISABLED !== '1') {
  const statusRefreshQueue = require('./queues/statusRefresh.queue');
  if (statusRefreshQueue) {
    // Add repeatable job to refresh pending statuses every N minutes
    statusRefreshQueue.add(
      'refreshPendingStatuses',
      { limit: 50 }, // Process 50 messages per run
      {
        repeat: {
          every: STATUS_REFRESH_INTERVAL, // Repeat every N milliseconds
          immediately: false // Don't run immediately on startup
        },
        jobId: 'status-refresh-periodic' // Unique ID to prevent duplicates
      }
    ).then(() => {
      console.log(`[Status Refresh] Scheduled periodic refresh every ${STATUS_REFRESH_INTERVAL / 1000 / 60} minutes`);
    }).catch(err => {
      console.error('[Status Refresh] Failed to schedule periodic refresh:', err.message);
    });
  }
}

// ========= START WORKERS (if enabled) =========
let workerProcess = null;
let schedulerWorkerProcess = null;
let statusRefreshWorkerProcess = null;
let contactImportWorkerProcess = null;
const WORKER_ENABLED = process.env.START_WORKER !== '0'; // Default: enabled, set START_WORKER=0 to disable

if (WORKER_ENABLED && process.env.QUEUE_DISABLED !== '1') {
  const { spawn } = require('child_process');
  const path = require('path');
  
  const apiPath = path.resolve(__dirname, '..'); // apps/api directory
  const apiNodeModules = path.join(apiPath, 'node_modules');
  
  // Set NODE_PATH to include apps/api/node_modules for module resolution
  const nodePath = [
    apiNodeModules,
    process.env.NODE_PATH || ''
  ].filter(Boolean).join(path.delimiter);
  
  const workerEnv = {
    ...process.env,
    NODE_PATH: nodePath
  };

  // Start SMS worker
  const smsWorkerPath = path.resolve(__dirname, '../../worker/src/sms.worker.js');
  console.log('[Server] Starting SMS worker...');
  workerProcess = spawn('node', [smsWorkerPath], {
    stdio: 'inherit',
    cwd: apiPath,
    env: workerEnv
  });
  
  workerProcess.on('error', (err) => {
    console.error('[Server] Failed to start SMS worker:', err.message);
  });
  
  workerProcess.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[Server] SMS worker stopped by signal: ${signal}`);
    } else if (code !== 0) {
      console.error(`[Server] SMS worker exited with code ${code}`);
    } else {
      console.log('[Server] SMS worker exited normally');
    }
  });
  
  workerProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[Server] SMS worker process closed with code ${code}`);
    }
  });

  // Start scheduler worker (for scheduled campaigns)
  const schedulerWorkerPath = path.resolve(__dirname, '../../worker/src/scheduler.worker.js');
  console.log('[Server] Starting scheduler worker...');
  schedulerWorkerProcess = spawn('node', [schedulerWorkerPath], {
    stdio: 'inherit',
    cwd: apiPath,
    env: workerEnv
  });
  
  schedulerWorkerProcess.on('error', (err) => {
    console.error('[Server] Failed to start scheduler worker:', err.message);
  });
  
  schedulerWorkerProcess.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[Server] Scheduler worker stopped by signal: ${signal}`);
    } else if (code !== 0) {
      console.error(`[Server] Scheduler worker exited with code ${code}`);
    } else {
      console.log('[Server] Scheduler worker exited normally');
    }
  });
  
  schedulerWorkerProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[Server] Scheduler worker process closed with code ${code}`);
    }
  });

  // Start status refresh worker
  if (STATUS_REFRESH_ENABLED) {
    const statusRefreshWorkerPath = path.resolve(__dirname, '../../worker/src/statusRefresh.worker.js');
    console.log('[Server] Starting status refresh worker...');
    statusRefreshWorkerProcess = spawn('node', [statusRefreshWorkerPath], {
      stdio: 'inherit',
      cwd: apiPath,
      env: workerEnv
    });
    
    statusRefreshWorkerProcess.on('error', (err) => {
      console.error('[Server] Failed to start status refresh worker:', err.message);
    });
    
    statusRefreshWorkerProcess.on('exit', (code, signal) => {
      if (signal) {
        console.log(`[Server] Status refresh worker stopped by signal: ${signal}`);
      } else if (code !== 0) {
        console.error(`[Server] Status refresh worker exited with code ${code}`);
      } else {
        console.log('[Server] Status refresh worker exited normally');
      }
    });
    
    statusRefreshWorkerProcess.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[Server] Status refresh worker process closed with code ${code}`);
      }
    });
  }

  // Start contact import worker
  const contactImportWorkerPath = path.resolve(__dirname, '../../worker/src/contactImport.worker.js');
  console.log('[Server] Starting contact import worker...');
  contactImportWorkerProcess = spawn('node', [contactImportWorkerPath], {
    stdio: 'inherit',
    cwd: apiPath,
    env: workerEnv
  });
  
  contactImportWorkerProcess.on('error', (err) => {
    console.error('[Server] Failed to start contact import worker:', err.message);
  });
  
  contactImportWorkerProcess.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[Server] Contact import worker stopped by signal: ${signal}`);
    } else if (code !== 0) {
      console.error(`[Server] Contact import worker exited with code ${code}`);
    } else {
      console.log('[Server] Contact import worker exited normally');
    }
  });
  
  contactImportWorkerProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[Server] Contact import worker process closed with code ${code}`);
    }
  });
}

// ========= START SERVER =========
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, () => {
  // use pino-http logger if present
  const logger = app?.logger || console;
  logger.info
    ? logger.info(`API running on http://localhost:${port}`)
    : console.log(`API running on http://localhost:${port}`);
});

// Graceful shutdown (SIGTERM/SIGINT)
const { closeRedis } = require('./lib/redis');

async function shutdown(signal) {
  console.log(`[${signal}] shutting down...`);
  
  // Stop workers first (in reverse order of importance)
  if (statusRefreshWorkerProcess) {
    console.log('[Server] Stopping status refresh worker...');
    statusRefreshWorkerProcess.kill('SIGTERM');
  }
  if (contactImportWorkerProcess) {
    console.log('[Server] Stopping contact import worker...');
    contactImportWorkerProcess.kill('SIGTERM');
  }
  if (schedulerWorkerProcess) {
    console.log('[Server] Stopping scheduler worker...');
    schedulerWorkerProcess.kill('SIGTERM');
  }
  if (workerProcess) {
    console.log('[Server] Stopping SMS worker...');
    workerProcess.kill('SIGTERM');
  }
  // Wait a bit for workers to clean up
  if (workerProcess || schedulerWorkerProcess || statusRefreshWorkerProcess || contactImportWorkerProcess) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  server.close(async () => {
    console.log('HTTP server closed.');
    // Close Redis connection gracefully
    await closeRedis();
    process.exit(0);
  });
  // Force-exit after 10s if not closed
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
