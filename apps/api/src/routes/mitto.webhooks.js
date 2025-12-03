// apps/api/src/routes/mitto.webhooks.js
const express = require('express');
const prisma = require('../lib/prisma');
const pino = require('pino');
const crypto = require('node:crypto');

const router = express.Router();
const logger = pino({ transport: { target: 'pino-pretty' } });

/**
 * Dev + Prod verification
 * - Dev: ?secret=WEBHOOK_SECRET  OR  header X-Webhook-Token: WEBHOOK_SECRET
 * - Prod: HMAC(SHA256, WEBHOOK_SECRET) over req.rawBody in header X-Webhook-Signature
 *
 * Ensure you have express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })
 * in your server setup so rawBody is available.
 */
function verifyWebhook(req) {
  const shared = process.env.WEBHOOK_SECRET;
  if (!shared) {return false;}

  // Dev conveniences
  if (req.query?.secret && req.query.secret === shared) {return true;}
  const token = req.header('X-Webhook-Token');
  if (token && token === shared) {return true;}

  // Prod HMAC
  const sig = req.header('X-Webhook-Signature');
  if (!sig || !req.rawBody) {return false;}
  const mac = crypto.createHmac('sha256', shared).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(mac, 'utf8'));
  } catch {
    return false;
  }
}

// Map Mitto deliveryStatus → our internal status
// Mitto sends: "Sent", "Delivered", "Failure" (capitalized)
// We only use "sent" and "failed" - map "Delivered" to "sent"
function mapStatus(s) {
  const v = String(s || '').toLowerCase().trim();
  // Mitto's exact values: "Delivered" → "sent", "Sent" → "sent", "Failure" → "failed"
  if (v === 'delivered' || v === 'delivrd' || v === 'completed' || v === 'ok') {
    // Map delivered to sent (we don't track delivered separately)
    return 'sent';
  }
  if (v === 'failure' || v === 'failed' || v === 'undelivered' || v === 'expired' || v === 'rejected' || v === 'error') {
    return 'failed';
  }
  if (v === 'sent' || v === 'queued' || v === 'accepted' || v === 'submitted' || v === 'enroute') {
    return 'sent';
  }
  return 'unknown';
}

/**
 * Persist a raw webhook for auditing/replay/dedup later.
 * Never blocks the request even if it fails.
 */
async function persistWebhook(provider, eventType, payload, providerMessageId) {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        eventType,
        payload,
        providerMessageId: providerMessageId || null
      }
    });
  } catch (e) {
    logger.warn({ err: e?.message }, 'WebhookEvent persist failed');
  }
}

/**
 * --- Delivery Status (DLR) ---
 * Accepts single object or array of objects. Always 202 to avoid retry storms.
 */
router.post('/webhooks/mitto/dlr', async (req, res) => {
  try {
    if (!verifyWebhook(req)) {return res.status(401).json({ ok: false });}

    const body = req.body;
    const events = Array.isArray(body) ? body : [body];

    let updated = 0;
    const affectedCampaigns = new Set(); // Track campaignIds that need aggregate updates

    for (const ev of events) {
      // Mitto webhook format: { messageId, deliveryStatus, ... }
      // Also support alternative field names for flexibility
      const providerId = ev?.messageId || ev?.id || ev?.MessageId || null;
      // Mitto sends deliveryStatus (not status)
      const statusIn   = ev?.deliveryStatus || ev?.status || ev?.Status || ev?.delivery_status || null;
      const doneAtRaw  = ev?.updatedAt || ev?.doneAt || ev?.timestamp || ev?.Timestamp || ev?.createdAt || new Date().toISOString();
      let doneAt       = new Date(doneAtRaw);
      const errorDesc  = ev?.error || ev?.Error || ev?.description || ev?.errorMessage || null;
      
      // Validate doneAt date
      if (isNaN(doneAt.getTime())) {
        logger.warn({ providerId, doneAtRaw }, 'DLR: invalid timestamp, using current time');
        doneAt = new Date();
      }

      // Persist raw webhook (best-effort)
      await persistWebhook('mitto', 'dlr', ev, providerId);

      if (!providerId) {
        logger.warn({ ev }, 'DLR without messageId — ignoring');
        continue;
      }

      const mapped = mapStatus(statusIn);
      
      logger.info({ 
        providerId, 
        statusIn, 
        mapped, 
        doneAt: doneAt.toISOString() 
      }, 'DLR webhook received');

      try {
        const msgs = await prisma.campaignMessage.findMany({
          where: { providerMessageId: providerId },
          select: { id: true, campaignId: true, ownerId: true, status: true }
        });

        if (msgs.length === 0) {
          logger.info({ providerId }, 'DLR: no local messages matched');
          continue;
        }

        logger.info({ 
          providerId, 
          messageCount: msgs.length, 
          currentStatuses: msgs.map(m => m.status),
          newStatus: mapped 
        }, 'DLR: updating messages');

        if (mapped === 'sent') {
          // Map both "Sent" and "Delivered" from Mitto to "sent" status
          // We don't track "delivered" separately - only "sent" and "failed"
          const r = await prisma.campaignMessage.updateMany({
            where: { providerMessageId: providerId },
            data: { 
              status: 'sent', 
              sentAt: doneAt,
              updatedAt: new Date()
            }
          });
          updated += r.count;
          logger.info({ providerId, updated: r.count, originalStatus: statusIn }, 'DLR: marked as sent');
          // Track affected campaigns
          msgs.forEach(m => {
            affectedCampaigns.add(`${m.campaignId}:${m.ownerId}`);
          });
        } else if (mapped === 'failed') {
          const r = await prisma.campaignMessage.updateMany({
            where: { providerMessageId: providerId },
            data: {
              status: 'failed',
              failedAt: doneAt,
              error: errorDesc || 'FAILED_DLR',
              updatedAt: new Date()
            }
          });
          updated += r.count;
          logger.info({ providerId, updated: r.count }, 'DLR: marked as failed');
          // Track affected campaigns
          msgs.forEach(m => {
            affectedCampaigns.add(`${m.campaignId}:${m.ownerId}`);
          });
        } else {
          logger.warn({ providerId, statusIn, mapped }, 'DLR unknown/ignored status');
        }

      } catch (e) {
        logger.error({ err: e, providerId, statusIn }, 'DLR update error');
      }
    }

    // Update campaign aggregates for affected campaigns (best-effort, non-blocking)
    if (affectedCampaigns.size > 0) {
      const { updateCampaignAggregates } = require('../services/campaignAggregates.service');
      const updatePromises = Array.from(affectedCampaigns).map(key => {
        const [campaignId, ownerId] = key.split(':').map(Number);
        return updateCampaignAggregates(campaignId, ownerId).catch(err => {
          logger.error({ campaignId, ownerId, err: err.message }, 'Failed to update campaign aggregates from webhook');
        });
      });
      // Fire and forget - don't block webhook response
      Promise.all(updatePromises).catch(() => {
        // Ignore errors - already logged
      });
    }

    // Always accept to prevent provider retries
    return res.status(202).json({ ok: true, updated });
  } catch (e) {
    logger.error({ err: e }, 'DLR handler error');
    return res.status(200).json({ ok: true });
  }
});

/**
 * --- Inbound MO (STOP) ---
 * Unsubscribes contact on STOP. Always 202.
 */
function normalizeMsisdn(s) {
  if (!s) {return null;}
  let v = String(s).trim();
  if (v.startsWith('00')) {v = '+' + v.slice(2);}
  if (!v.startsWith('+') && /^\d{10,15}$/.test(v)) {v = '+30' + v;} // adjust default country as needed
  return v;
}

router.post('/webhooks/mitto/inbound', async (req, res) => {
  try {
    if (!verifyWebhook(req)) {return res.status(401).json({ ok: false });}

    const body = req.body;
    const from = body.from || body.msisdn || body.sender;
    const text = (body.text || body.message || '').toString();

    // Persist inbound for audit (best-effort)
    await persistWebhook('mitto', 'inbound', body, null);

    if (!from || !text) {return res.status(202).json({ ok: true });}

    const phone = normalizeMsisdn(from);

    // Simple STOP detection (extend with STOPALL etc. if needed)
    if (/^\s*stop\b/i.test(text)) {
      // Note: This updates all contacts with this phone across all owners
      // In a multi-tenant system, you might want to scope by owner if phone is not globally unique
      const r = await prisma.contact.updateMany({
        where: { phone, isSubscribed: true },
        data: { isSubscribed: false, unsubscribedAt: new Date() }
      });
      logger.info({ phone, count: r.count }, 'Inbound STOP → unsubscribed');
    }

    return res.status(202).json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, 'Inbound handler error');
    return res.status(200).json({ ok: true });
  }
});

module.exports = router;
