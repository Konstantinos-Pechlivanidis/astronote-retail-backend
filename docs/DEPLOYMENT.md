# Deployment Guide

## Overview

This application consists of:
- **API Server**: Express.js server handling HTTP requests
- **SMS Worker**: Processes SMS sending jobs from the queue
- **Scheduler Worker**: Processes scheduled campaigns
- **Status Refresh Worker**: Periodically refreshes message statuses

## Deployment Options

### Option 1: All-in-One (Simple Deployment)

Run everything in one process - server + workers:

```bash
npm run start:all
# or
npm run start
```

**When to use:**
- Small deployments
- Development/testing
- Single server setups
- Simple deployments where you don't need to scale workers separately

**Configuration:**
- Workers are enabled by default (`START_WORKER !== '0'`)
- To disable workers: `START_WORKER=0 npm run start`
- Workers run as child processes spawned by the server

### Option 2: Server Only (Production with Process Manager)

Run only the API server, workers run as separate processes:

```bash
# Start server only
npm run start:server-only

# Start workers separately (in separate terminals/processes)
npm run worker:sms
npm run worker:scheduler
```

**When to use:**
- Production deployments
- When using process managers (PM2, systemd, Docker Compose, Kubernetes)
- When you need to scale workers independently
- When you want better process isolation and monitoring

**With PM2:**

```bash
# ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'api-server',
      script: 'apps/api/src/server.js',
      cwd: 'apps/api',
      env: { START_WORKER: '0' }
    },
    {
      name: 'sms-worker',
      script: 'apps/worker/src/sms.worker.js',
      cwd: 'apps/api'
    },
    {
      name: 'scheduler-worker',
      script: 'apps/worker/src/scheduler.worker.js',
      cwd: 'apps/api'
    }
  ]
};

# Start all
pm2 start ecosystem.config.js
```

**With Docker Compose:**

```yaml
version: '3.8'
services:
  api:
    build: .
    command: npm run start:server-only
    environment:
      - START_WORKER=0
    ports:
      - "3001:3001"
  
  sms-worker:
    build: .
    command: npm run worker:sms
    depends_on:
      - api
  
  scheduler-worker:
    build: .
    command: npm run worker:scheduler
    depends_on:
      - api
```

## Environment Variables

### Worker Control

- `START_WORKER`: Enable/disable workers when starting server
  - Default: `'1'` (enabled)
  - Set to `'0'` to disable workers (for server-only mode)

- `QUEUE_DISABLED`: Disable all queue functionality
  - Default: `'0'` (enabled)
  - Set to `'1'` to disable queues and workers

### Worker Configuration

- `SCHEDULER_CONCURRENCY`: Number of concurrent scheduler jobs (default: 2)
- `STATUS_REFRESH_ENABLED`: Enable status refresh worker (default: enabled)
- `STATUS_REFRESH_INTERVAL`: Status refresh interval in ms (default: 600000 = 10 minutes)

## Recommended Production Setup

For production, we recommend **Option 2** (separate processes) because:

1. **Better Monitoring**: Each process can be monitored independently
2. **Scalability**: Scale workers independently based on load
3. **Fault Isolation**: If one worker crashes, others continue running
4. **Resource Management**: Allocate resources per process type
5. **Process Manager Integration**: Works better with PM2, systemd, Kubernetes, etc.

### Example: PM2 Production Setup

```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'sms-api',
      script: 'src/server.js',
      cwd: './apps/api',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        START_WORKER: '0',
        PORT: 3001
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'sms-worker',
      script: '../worker/src/sms.worker.js',
      cwd: './apps/api',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/sms-worker-error.log',
      out_file: './logs/sms-worker-out.log'
    },
    {
      name: 'scheduler-worker',
      script: '../worker/src/scheduler.worker.js',
      cwd: './apps/api',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/scheduler-worker-error.log',
      out_file: './logs/scheduler-worker-out.log'
    }
  ]
};
EOF

# Start all processes
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

## Development

For development, use the all-in-one approach:

```bash
npm run dev
```

This starts the server with `--watch` mode and all workers automatically.

## Troubleshooting

### Workers not starting

1. Check `START_WORKER` environment variable (should not be `'0'`)
2. Check `QUEUE_DISABLED` environment variable (should not be `'1'`)
3. Check Redis connection (workers require Redis)
4. Check logs for errors

### Module not found errors

Workers need to run from `apps/api` directory to find dependencies:
- Use the npm scripts: `npm run worker:sms`
- Or set `NODE_PATH=./node_modules` when running manually

### Workers crash on startup

1. Check Redis is running and accessible
2. Check database connection
3. Check environment variables are set correctly
4. Review worker logs for specific errors

