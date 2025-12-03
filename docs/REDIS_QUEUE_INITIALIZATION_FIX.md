# Redis and Queue Initialization Fix

## Problem

When starting the API server, misleading log messages appeared:

```
[Scheduler Queue] Redis not available, scheduler queue disabled
[Queue] Redis not available, SMS queue disabled
API running on http://localhost:3001
[Redis] connected
[Redis] ready
```

**Root Cause**: 
- Redis client uses `lazyConnect: true`, so it doesn't connect immediately
- Queue modules check `isRedisEnabled()` at module load time (synchronous)
- At that point, Redis hasn't connected yet, so `isRedisEnabled()` returns `false`
- Queues are marked as disabled and set to `null`
- Then Redis connects asynchronously, but queues are already `null`

## Solution

### Changes Made

1. **Removed premature `isRedisEnabled()` checks** from queue initialization
   - Queues now only check if the Redis client exists (not `null`)
   - BullMQ can work with a Redis client that connects asynchronously
   - BullMQ will wait for Redis to be ready before processing jobs

2. **Updated Redis connection logging**
   - Changed "connected" to "connecting..." to be more accurate
   - Only set `isEnabled = true` when Redis is actually "ready" (not just "connected")

3. **Improved queue initialization logging**
   - Queues log when they're initialized (with configuration)
   - Queues log when they're ready (after Redis connects)
   - Handle case where Redis is already ready when listener is set up

### Files Modified

1. **`apps/api/src/queues/scheduler.queue.js`**
   - Removed `isRedisEnabled()` check
   - Only check if `connection` exists
   - Added ready state logging

2. **`apps/api/src/queues/sms.queue.js`**
   - Removed `isRedisEnabled()` check
   - Only check if `connection` exists
   - Added ready state logging
   - Improved log messages

3. **`apps/api/src/lib/redis.js`**
   - Updated "connected" log to "connecting..." for accuracy
   - Only set `isEnabled = true` on "ready" event (not "connect")

## New Behavior

### Startup Sequence

1. **Redis client created** (with `lazyConnect: true`)
2. **Queues initialized** (with Redis client, even if not connected yet)
3. **Redis connection attempt** (async)
4. **Redis connects** → logs `[Redis] connecting...`
5. **Redis ready** → logs `[Redis] ready`
6. **Queues ready** → logs `[Scheduler Queue] Ready` and `[SMS Queue] Ready`

### Expected Log Output

```
[SMS Queue] Initialized (attempts=5, backoff=3000ms, limiter={...})
[Redis] connecting...
[Redis] ready
[Scheduler Queue] Ready
[SMS Queue] Ready
API running on http://localhost:3001
```

### Error Cases

- **If Redis is explicitly disabled** (`REDIS_URL=disabled`):
  ```
  [Scheduler Queue] Redis client not available, scheduler queue disabled
  [SMS Queue] Redis client not available, SMS queue disabled
  ```

- **If Redis connection fails**:
  ```
  [Redis] initial connection failed: <error message>
  ```
  (Queues will still be created but won't process jobs until Redis connects)

## Technical Details

### Why This Works

- **BullMQ handles async connections**: BullMQ can work with a Redis client that connects asynchronously. It will wait for Redis to be ready before processing jobs.

- **No race conditions**: By removing the `isRedisEnabled()` check at module load time, we avoid the race condition where queues are disabled before Redis has a chance to connect.

- **Accurate state reporting**: Logs now accurately reflect the actual state:
  - Queues are initialized when the client exists
  - Queues are ready when Redis is ready
  - No false "disabled" messages

### Backward Compatibility

- All existing code that checks `if (schedulerQueue)` or `if (smsQueue)` continues to work
- Queues are only `null` if Redis client is truly unavailable (not just not connected yet)
- No breaking changes to the API

## Testing

To verify the fix:

1. Start the API server: `npm run dev`
2. Check logs for correct initialization sequence
3. Verify queues are available (not `null`) after Redis connects
4. Test queue operations (e.g., schedule a campaign)

## Related Files

- `apps/api/src/lib/redis.js` - Redis client singleton
- `apps/api/src/queues/scheduler.queue.js` - Scheduler queue
- `apps/api/src/queues/sms.queue.js` - SMS queue
- `apps/api/src/routes/campaigns.js` - Uses queues
- `apps/api/src/routes/jobs.js` - Queue health endpoint

