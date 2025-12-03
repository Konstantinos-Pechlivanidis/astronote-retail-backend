// apps/api/src/routes/jobs.js
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const smsQueue = require('../queues/sms.queue');
const schedulerQueue = require('../queues/scheduler.queue');
const router = express.Router();

router.get('/jobs/health', requireAuth, async (_req, res, next) => {
  try {
    const out = {};
    if (smsQueue) {out.sms = await smsQueue.getJobCounts();}
    else {out.sms = 'disabled';}

    if (schedulerQueue) {
      const counts = await schedulerQueue.getJobCounts();
      out.scheduler = counts;
      
      // Also get waiting/delayed jobs for debugging
      const waiting = await schedulerQueue.getWaiting();
      const delayed = await schedulerQueue.getDelayed();
      const active = await schedulerQueue.getActive();
      const failed = await schedulerQueue.getFailed();
      
      out.schedulerDetails = {
        waiting: waiting.length,
        delayed: delayed.length,
        active: active.length,
        failed: failed.length,
        waitingJobs: waiting.slice(0, 5).map(j => ({
          id: j.id,
          name: j.name,
          data: j.data,
          opts: j.opts
        })),
        delayedJobs: delayed.slice(0, 5).map(j => ({
          id: j.id,
          name: j.name,
          data: j.data,
          delay: j.opts?.delay,
          timestamp: j.timestamp
        }))
      };
    } else {
      out.scheduler = 'disabled';
    }

    res.json(out);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
