// apps/api/src/routes/billing.js
const { Router } = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { getBalance } = require('../services/wallet.service');
const {
  getSubscriptionStatus,
  getPlanConfig,
  calculateTopupPrice
} = require('../services/subscription.service');
const {
  createSubscriptionCheckoutSession,
  createCreditTopupCheckoutSession,
  getCustomerPortalUrl,
  cancelSubscription
} = require('../services/stripe.service');
const pino = require('pino');

const r = Router();
const logger = pino({ name: 'billing-routes' });

/**
 * GET /billing/balance
 * Returns balance and subscription status
 */
r.get('/billing/balance', requireAuth, async (req, res, next) => {
  try {
    const balance = await getBalance(req.user.id);
    const subscription = await getSubscriptionStatus(req.user.id);
    res.json({ balance, subscription });
  } catch (e) { next(e); }
});

/**
 * GET /billing/transactions
 * Query: page(1), pageSize(10..100)
 */
r.get('/billing/transactions', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));
    const [total, items] = await Promise.all([
      prisma.creditTransaction.count({ where: { ownerId: req.user.id } }),
      prisma.creditTransaction.findMany({
        where: { ownerId: req.user.id },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ page, pageSize, total, items });
  } catch (e) { next(e); }
});

/**
 * GET /billing/packages
 * List active packages with Stripe price IDs
 * Credit packs are only available when user has active subscription
 */
r.get('/billing/packages', requireAuth, async (req, res, next) => {
  try {
    // Check subscription status - credit packs are only unlocked for active subscriptions
    const subscription = await getSubscriptionStatus(req.user.id);
    
    // Only return packages if user has active subscription
    // This ensures credit packs are "unlocked" only for subscribed users
    if (!subscription.active) {
      return res.json([]);
    }
    
    const currency = (req.query.currency || 'EUR').toUpperCase();
    const items = await prisma.package.findMany({
      where: { active: true },
      orderBy: { units: 'asc' },
      select: {
        id: true,
        name: true,
        units: true,
        priceCents: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        // Include Stripe price IDs if available
        stripePriceIdEur: true,
        stripePriceIdUsd: true
      }
    });

    // Enrich with Stripe price IDs from environment if not in DB
    const { getStripePriceId } = require('../services/stripe.service');
    const enriched = items.map(pkg => {
      const priceId = getStripePriceId(pkg.name, currency, pkg);
      
      return {
        ...pkg,
        stripePriceId: priceId,
        available: !!priceId // Indicate if Stripe checkout is available
      };
    });

    res.json(enriched);
  } catch (e) { next(e); }
});

/**
 * GET /billing/purchases
 * List user's purchase history
 * Query: page, pageSize, status? (pending/paid/failed/refunded)
 */
r.get('/billing/purchases', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));
    const status = req.query.status; // Optional filter by status
    
    const where = { ownerId: req.user.id };
    if (status && ['pending', 'paid', 'failed', 'refunded'].includes(status)) {
      where.status = status;
    }
    
    const [total, items] = await Promise.all([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        include: { package: { select: { id: true, name: true, units: true } } },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ page, pageSize, total, items });
  } catch (e) { next(e); }
});

/**
 * POST /billing/seed-packages  (DEV only - optional)
 * Body: { items: [{ name, units, priceCents }] }
 */
r.post('/billing/seed-packages', requireAuth, async (req, res, next) => {
  try {
    // Simple guard: allow only if env allows seeding
    if (process.env.ALLOW_BILLING_SEED !== '1') {
      return res.status(403).json({ 
        message: 'Database seeding is disabled', 
        code: 'FORBIDDEN' 
      });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const data = items.map(x => ({
      name: String(x.name),
      units: Number(x.units),
      priceCents: Number(x.priceCents),
      active: true,
      stripePriceIdEur: x.stripePriceIdEur || null,
      stripePriceIdUsd: x.stripePriceIdUsd || null
    })).filter(x => x.name && x.units > 0 && x.priceCents >= 0);

    // Upsert by unique name
    for (const p of data) {
      await prisma.package.upsert({
        where: { name: p.name },
        update: { 
          units: p.units, 
          priceCents: p.priceCents, 
          active: true,
          stripePriceIdEur: p.stripePriceIdEur,
          stripePriceIdUsd: p.stripePriceIdUsd
        },
        create: p
      });
    }
    const all = await prisma.package.findMany({ where: { active: true }, orderBy: { units: 'asc' } });
    res.json({ ok: true, items: all });
  } catch (e) { next(e); }
});

/**
 * POST /billing/purchase
 * Body: { packageId, currency? (EUR/USD) }
 * Creates a Stripe checkout session for the package
 */
r.post('/billing/purchase', requireAuth, async (req, res, next) => {
  try {
    const packageId = Number(req.body?.packageId);
    const currency = (req.body?.currency || 'EUR').toUpperCase();

    if (!packageId) {
      return res.status(400).json({ 
        message: 'Package ID is required', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const pkg = await prisma.package.findFirst({ where: { id: packageId, active: true } });
    if (!pkg) {
      return res.status(404).json({ 
        message: 'Credit pack not found or is no longer available', 
        code: 'RESOURCE_NOT_FOUND' 
      });
    }

    // Create purchase record
    const purchase = await prisma.purchase.create({
      data: {
        ownerId: req.user.id,
        packageId: pkg.id,
        status: 'pending',
        amountCents: pkg.priceCents,
        currency
      }
    });

    // Helper to ensure /retail path is included
    const ensureRetailPath = (url) => {
      if (!url || url.includes('localhost')) {
        return url; // Don't modify localhost URLs
      }
      const trimmed = url.trim().replace(/\/$/, '');
      if (!trimmed.endsWith('/retail')) {
        return `${trimmed}/retail`;
      }
      return trimmed;
    };
    
    const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://astronote-retail-frontend.onrender.com';
    const frontendUrl = ensureRetailPath(baseUrl);
    const successUrl = `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/billing/cancel`;

    // Create Stripe checkout session
    const { createCheckoutSession } = require('../services/stripe.service');
    const session = await createCheckoutSession({
      ownerId: req.user.id,
      userEmail: req.user.email,
      package: pkg,
      currency,
      successUrl,
      cancelUrl
    });

    // Link session ID to purchase
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { stripeSessionId: session.id }
    });

    res.status(201).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      purchaseId: purchase.id
    });
  } catch (e) {
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }
    next(e);
  }
});

/**
 * GET /api/subscriptions/current
 * Get current subscription status
 */
r.get('/subscriptions/current', requireAuth, async (req, res, next) => {
  try {
    const subscription = await getSubscriptionStatus(req.user.id);
    const planConfig = subscription.planType ? getPlanConfig(subscription.planType) : null;
    res.json({
      ...subscription,
      plan: planConfig
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/subscriptions/subscribe
 * Create subscription checkout session
 * Body: { planType: 'starter' | 'pro' }
 */
r.post('/subscriptions/subscribe', requireAuth, async (req, res, next) => {
  try {
    const planType = req.body?.planType;
    
    if (!planType || !['starter', 'pro'].includes(planType)) {
      return res.status(400).json({ 
        message: 'Plan type must be "starter" or "pro"', 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Check if user already has an active subscription
    const currentSubscription = await getSubscriptionStatus(req.user.id);
    if (currentSubscription.active) {
      logger.info({ 
        userId: req.user.id, 
        currentPlanType: currentSubscription.planType,
        requestedPlanType: planType
      }, 'User attempted to subscribe while already having active subscription');
      return res.status(400).json({ 
        message: 'You already have an active subscription. Please cancel your current subscription before subscribing to a new plan.',
        code: 'ALREADY_SUBSCRIBED',
        currentPlan: currentSubscription.planType
      });
    }

    // Helper to ensure /retail path is included
    const ensureRetailPath = (url) => {
      if (!url || url.includes('localhost')) {
        return url; // Don't modify localhost URLs
      }
      const trimmed = url.trim().replace(/\/$/, '');
      if (!trimmed.endsWith('/retail')) {
        return `${trimmed}/retail`;
      }
      return trimmed;
    };
    
    const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://astronote-retail-frontend.onrender.com';
    const frontendUrl = ensureRetailPath(baseUrl);
    const successUrl = `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/billing/cancel`;

    const session = await createSubscriptionCheckoutSession({
      ownerId: req.user.id,
      userEmail: req.user.email,
      planType,
      currency: 'EUR',
      successUrl,
      cancelUrl
    });

    res.status(201).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      planType
    });
  } catch (e) {
    // Handle specific error cases
    if (e.message?.includes('Stripe price ID not found')) {
      return res.status(400).json({ 
        message: e.message,
        code: 'MISSING_PRICE_ID'
      });
    }
    if (e.message?.includes('not a recurring price') || e.message?.includes('recurring price')) {
      return res.status(400).json({ 
        message: e.message,
        code: 'INVALID_PRICE_TYPE'
      });
    }
    if (e.message?.includes('not found in Stripe')) {
      return res.status(400).json({ 
        message: e.message,
        code: 'PRICE_NOT_FOUND'
      });
    }
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable',
        code: 'STRIPE_NOT_CONFIGURED'
      });
    }
    if (e.message?.includes('Stripe error:')) {
      return res.status(400).json({ 
        message: e.message,
        code: 'STRIPE_ERROR'
      });
    }
    if (e.message?.includes('Invalid plan type')) {
      return res.status(400).json({ 
        message: e.message,
        code: 'INVALID_PLAN_TYPE'
      });
    }
    next(e);
  }
});

/**
 * POST /api/subscriptions/update
 * Update subscription plan (upgrade/downgrade)
 * Body: { planType: 'starter' | 'pro' }
 */
r.post('/subscriptions/update', requireAuth, async (req, res, next) => {
  try {
    const planType = req.body?.planType;
    
    if (!planType || !['starter', 'pro'].includes(planType)) {
      return res.status(400).json({ 
        message: 'Plan type must be "starter" or "pro"', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const subscription = await getSubscriptionStatus(req.user.id);
    
    if (!subscription.active || !subscription.stripeSubscriptionId) {
      return res.status(400).json({ 
        message: 'No active subscription found. Please subscribe first.',
        code: 'NO_ACTIVE_SUBSCRIPTION'
      });
    }

    // Check if already on the requested plan
    if (subscription.planType === planType) {
      return res.status(400).json({ 
        message: `You are already on the ${planType} plan.`,
        code: 'ALREADY_ON_PLAN',
        currentPlan: planType
      });
    }

    // Check if update is already in progress (idempotency check)
    // Get current subscription from Stripe to check metadata
    const stripe = require('../services/stripe.service').stripe;
    if (!stripe) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }

    let stripeSubscription = null;
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      
      // Check if planType in Stripe already matches requested planType
      const stripeMetadata = stripeSubscription.metadata || {};
      const stripePlanType = stripeMetadata.planType;
      
      if (stripePlanType === planType && subscription.planType === planType) {
        logger.info({ 
          userId: req.user.id, 
          subscriptionId: subscription.stripeSubscriptionId,
          planType 
        }, 'Subscription already on requested plan (idempotency check)');
        
        return res.json({ 
          ok: true, 
          message: `Subscription is already on the ${planType} plan`,
          planType,
          alreadyUpdated: true
        });
      }
    } catch (err) {
      logger.warn({ 
        subscriptionId: subscription.stripeSubscriptionId, 
        err: err.message 
      }, 'Failed to retrieve subscription from Stripe for idempotency check');
      // Continue with update anyway
    }

    const { updateSubscription } = require('../services/stripe.service');
    await updateSubscription(subscription.stripeSubscriptionId, planType);

    // Update local DB immediately (idempotent - activateSubscription checks current state)
    const { activateSubscription } = require('../services/subscription.service');
    await activateSubscription(
      req.user.id,
      subscription.stripeCustomerId,
      subscription.stripeSubscriptionId,
      planType
    );

    logger.info({ 
      userId: req.user.id, 
      oldPlan: subscription.planType,
      newPlan: planType,
      subscriptionId: subscription.stripeSubscriptionId
    }, 'Subscription plan updated');

    res.json({ 
      ok: true, 
      message: `Subscription updated to ${planType} plan successfully`,
      planType
    });
  } catch (e) {
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }
    if (e.message?.includes('Stripe price ID not found')) {
      return res.status(400).json({ 
        message: e.message,
        code: 'MISSING_PRICE_ID'
      });
    }
    next(e);
  }
});

/**
 * POST /api/subscriptions/cancel
 * Cancel subscription (via Stripe API)
 * Immediately updates local DB to avoid race conditions with webhook
 */
r.post('/subscriptions/cancel', requireAuth, async (req, res, next) => {
  try {
    const subscription = await getSubscriptionStatus(req.user.id);
    
    if (!subscription.active || !subscription.stripeSubscriptionId) {
      return res.status(400).json({ 
        message: 'No active subscription found to cancel', 
        code: 'INACTIVE_SUBSCRIPTION' 
      });
    }

    // Cancel subscription in Stripe
    await cancelSubscription(subscription.stripeSubscriptionId);
    
    // Immediately update local DB to avoid race condition
    // Webhook handler will also process this, but having it here ensures immediate consistency
    const { deactivateSubscription } = require('../services/subscription.service');
    await deactivateSubscription(req.user.id, 'cancelled');
    
    res.json({ ok: true, message: 'Subscription cancelled successfully' });
  } catch (e) {
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }
    next(e);
  }
});

/**
 * GET /api/subscriptions/portal
 * Get Stripe customer portal URL for self-service management
 */
r.get('/subscriptions/portal', requireAuth, async (req, res, next) => {
  try {
    const subscription = await getSubscriptionStatus(req.user.id);
    
    if (!subscription.stripeCustomerId) {
      return res.status(400).json({ 
        message: 'No payment account found. Please subscribe to a plan first.', 
        code: 'MISSING_CUSTOMER_ID' 
      });
    }

    const portalUrl = await getCustomerPortalUrl({
      customerId: subscription.stripeCustomerId,
      returnUrl: (() => {
        const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://astronote-retail-frontend.onrender.com';
        if (baseUrl.includes('localhost')) {
          return `${baseUrl}/credits`;
        }
        const trimmed = baseUrl.trim().replace(/\/$/, '');
        const url = trimmed.endsWith('/retail') ? trimmed : `${trimmed}/retail`;
        return `${url}/credits`;
      })()
    });

    res.json({ ok: true, portalUrl });
  } catch (e) {
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }
    next(e);
  }
});

/**
 * POST /api/billing/topup
 * Create credit top-up checkout session
 * Body: { credits: number }
 */
r.post('/billing/topup', requireAuth, async (req, res, next) => {
  try {
    const credits = Number(req.body?.credits);
    
    if (!credits || !Number.isInteger(credits) || credits <= 0) {
      return res.status(400).json({ 
        message: 'Credits must be a positive number', 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Prevent unreasonably large credit purchases (max 1 million credits per transaction)
    // This prevents potential overflow issues and abuse
    const MAX_CREDITS_PER_PURCHASE = 1000000;
    if (credits > MAX_CREDITS_PER_PURCHASE) {
      return res.status(400).json({ 
        message: `Maximum ${MAX_CREDITS_PER_PURCHASE.toLocaleString()} credits allowed per purchase`,
        code: 'MAX_CREDITS_EXCEEDED'
      });
    }

    // Credit top-ups are available to all users (subscription not required)
    // This allows users to buy credits even without a subscription

    // Calculate price
    const price = calculateTopupPrice(credits);

    // Helper to ensure /retail path is included
    const ensureRetailPath = (url) => {
      if (!url || url.includes('localhost')) {
        return url; // Don't modify localhost URLs
      }
      const trimmed = url.trim().replace(/\/$/, '');
      if (!trimmed.endsWith('/retail')) {
        return `${trimmed}/retail`;
      }
      return trimmed;
    };
    
    const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://astronote-retail-frontend.onrender.com';
    const frontendUrl = ensureRetailPath(baseUrl);
    const successUrl = `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/billing/cancel`;

    const session = await createCreditTopupCheckoutSession({
      ownerId: req.user.id,
      userEmail: req.user.email,
      credits,
      priceEur: price.priceEurWithVat,
      currency: 'EUR',
      successUrl,
      cancelUrl
    });

    res.status(201).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      credits,
      priceEur: price.priceEurWithVat,
      priceBreakdown: price
    });
  } catch (e) {
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }
    next(e);
  }
});

/**
 * GET /api/billing/topup/calculate
 * Calculate price for given number of credits
 * Query: ?credits=100
 */
r.get('/billing/topup/calculate', requireAuth, async (req, res, next) => {
  try {
    const credits = Number(req.query.credits);
    
    if (!credits || !Number.isInteger(credits) || credits <= 0) {
      return res.status(400).json({ 
        message: 'Credits must be a positive number', 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Prevent unreasonably large credit purchases (max 1 million credits per transaction)
    const MAX_CREDITS_PER_PURCHASE = 1000000;
    if (credits > MAX_CREDITS_PER_PURCHASE) {
      return res.status(400).json({ 
        message: `Maximum ${MAX_CREDITS_PER_PURCHASE.toLocaleString()} credits allowed per purchase`,
        code: 'MAX_CREDITS_EXCEEDED'
      });
    }

    const price = calculateTopupPrice(credits);
    
    res.json(price);
  } catch (e) { 
    if (e.message?.includes('Invalid credits amount')) {
      return res.status(400).json({ 
        message: e.message || 'An error occurred while calculating the price', 
        code: 'PRICE_CALCULATION_ERROR' 
      });
    }
    next(e); 
  }
});

/**
 * POST /api/subscriptions/verify-session
 * Manually verify and activate subscription from checkout session
 * Body: { sessionId: string }
 * Useful if webhook wasn't processed
 */
r.post('/subscriptions/verify-session', requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ 
        message: 'Session ID is required', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const { getCheckoutSession } = require('../services/stripe.service');
    const {
      activateSubscription,
      allocateFreeCredits
    } = require('../services/subscription.service');

    // Retrieve session from Stripe
    const session = await getCheckoutSession(sessionId);
    
    // Verify session belongs to this user
    const metadata = session.metadata || {};
    const ownerId = Number(metadata.ownerId);
    
    if (ownerId !== req.user.id) {
      return res.status(403).json({ 
        message: 'This payment session does not belong to your account', 
        code: 'AUTHORIZATION_ERROR' 
      });
    }

    // Check if this is a subscription session
    if (session.mode !== 'subscription') {
      return res.status(400).json({ 
        message: 'This payment session is not for a subscription', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const planType = metadata.planType;
    if (!planType || !['starter', 'pro'].includes(planType)) {
      return res.status(400).json({ 
        message: 'Invalid plan type in payment session', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const subscriptionId = session.subscription;
    const customerId = session.customer;

    if (!subscriptionId) {
      return res.status(400).json({ 
        message: 'Payment session does not contain a subscription', 
        code: 'VALIDATION_ERROR' 
      });
    }

    // Get subscription from Stripe
    const stripe = require('../services/stripe.service').stripe;
    if (!stripe) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }

    let stripeSubscription = null;
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (err) {
      return res.status(400).json({ 
        message: 'Failed to retrieve subscription information', 
        code: 'SUBSCRIPTION_RETRIEVAL_ERROR' 
      });
    }

    // Check if subscription is already active (idempotency check)
    // This prevents duplicate activations if webhook already processed
    const currentSubscription = await getSubscriptionStatus(req.user.id);
    if (currentSubscription.active && currentSubscription.stripeSubscriptionId === subscriptionId) {
      logger.info({ 
        userId: req.user.id, 
        subscriptionId,
        planType,
        currentPlanType: currentSubscription.planType
      }, 'Subscription already active, skipping activation (idempotency)');
      
      // Still try to allocate credits (idempotent check inside allocateFreeCredits)
      // This ensures credits are allocated even if webhook failed at that step
      const result = await allocateFreeCredits(req.user.id, planType, `sub_${subscriptionId}`, stripeSubscription);
      
      return res.json({
        ok: true,
        subscription: {
          active: true,
          planType: currentSubscription.planType || planType,
          subscriptionId,
          customerId
        },
        credits: {
          allocated: result.allocated,
          credits: result.credits || 0,
          reason: result.reason || 'already_processed'
        }
      });
    }

    // Activate subscription (only if not already active)
    logger.info({ 
      userId: req.user.id, 
      subscriptionId,
      planType,
      currentStatus: currentSubscription.status
    }, 'Activating subscription via manual verification');
    await activateSubscription(req.user.id, customerId, subscriptionId, planType);

    // Allocate free credits
    const result = await allocateFreeCredits(req.user.id, planType, `sub_${subscriptionId}`, stripeSubscription);

    res.json({
      ok: true,
      subscription: {
        active: true,
        planType,
        subscriptionId,
        customerId
      },
      credits: {
        allocated: result.allocated,
        credits: result.credits || 0,
        reason: result.reason
      }
    });
  } catch (e) {
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }
    next(e);
  }
});

/**
 * POST /api/billing/verify-payment
 * Generic payment verification endpoint for all payment types
 * Body: { sessionId: string }
 * Returns payment type and verification status
 */
r.post('/billing/verify-payment', requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ 
        message: 'Session ID is required', 
        code: 'VALIDATION_ERROR' 
      });
    }

    const { getCheckoutSession } = require('../services/stripe.service');
    const { getBalance } = require('../services/wallet.service');
    const { getSubscriptionStatus } = require('../services/subscription.service');

    // Retrieve session from Stripe
    const session = await getCheckoutSession(sessionId);
    
    // Verify session belongs to this user
    const metadata = session.metadata || {};
    const ownerId = Number(metadata.ownerId);
    
    if (ownerId !== req.user.id) {
      return res.status(403).json({ 
        message: 'This payment session does not belong to your account', 
        code: 'AUTHORIZATION_ERROR' 
      });
    }

    const paymentType = metadata.type || (session.mode === 'subscription' ? 'subscription' : 'payment');
    
    // Handle subscription payments
    if (paymentType === 'subscription' || session.mode === 'subscription') {
      // Call subscription verify-session logic inline
      const {
        activateSubscription,
        allocateFreeCredits
      } = require('../services/subscription.service');

      const planType = metadata.planType;
      if (!planType || !['starter', 'pro'].includes(planType)) {
        return res.status(400).json({ 
          message: 'Invalid plan type in payment session', 
          code: 'VALIDATION_ERROR' 
        });
      }

      const subscriptionId = session.subscription;
      const customerId = session.customer;

      if (!subscriptionId) {
        return res.status(400).json({ 
          message: 'Payment session does not contain a subscription', 
          code: 'VALIDATION_ERROR' 
        });
      }

      const stripe = require('../services/stripe.service').stripe;
      if (!stripe) {
        return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
      }

      let stripeSubscription = null;
      try {
        stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (err) {
        return res.status(400).json({ 
        message: 'Failed to retrieve subscription information', 
        code: 'SUBSCRIPTION_RETRIEVAL_ERROR' 
      });
      }

      const currentSubscription = await getSubscriptionStatus(req.user.id);
      if (currentSubscription.active && currentSubscription.stripeSubscriptionId === subscriptionId) {
        const result = await allocateFreeCredits(req.user.id, planType, `sub_${subscriptionId}`, stripeSubscription);
        return res.json({
          ok: true,
          paymentType: 'subscription',
          subscription: {
            active: true,
            planType: currentSubscription.planType || planType,
            subscriptionId,
            customerId
          },
          credits: {
            allocated: result.allocated,
            credits: result.credits || 0,
            reason: result.reason || 'already_processed'
          }
        });
      }

      await activateSubscription(req.user.id, customerId, subscriptionId, planType);
      const result = await allocateFreeCredits(req.user.id, planType, `sub_${subscriptionId}`, stripeSubscription);

      return res.json({
        ok: true,
        paymentType: 'subscription',
        subscription: {
          active: true,
          planType,
          subscriptionId,
          customerId
        },
        credits: {
          allocated: result.allocated,
          credits: result.credits || 0,
          reason: result.reason
        }
      });
    }

    // Handle credit top-up payments
    if (paymentType === 'credit_topup') {
      const credits = Number(metadata.credits);
      
      // Check if credits were already added (idempotency)
      const balance = await getBalance(req.user.id);
      
      // Check for transaction with this session ID
      const existingTxn = await prisma.creditTransaction.findFirst({
        where: {
          ownerId: req.user.id,
          reason: 'stripe:topup',
          meta: {
            path: ['sessionId'],
            equals: sessionId
          }
        }
      });

      if (existingTxn) {
        return res.json({
          ok: true,
          paymentType: 'credit_topup',
          credits: {
            allocated: true,
            credits: credits,
            reason: 'already_processed'
          },
          balance
        });
      }

      // Credits should be added by webhook, but if not, we'll show processing
      return res.json({
        ok: true,
        paymentType: 'credit_topup',
        credits: {
          allocated: false,
          credits: credits,
          reason: 'processing'
        },
        balance
      });
    }

    // Handle credit pack purchases
    const packageId = Number(metadata.packageId);
    if (packageId) {
      const purchase = await prisma.purchase.findFirst({
        where: {
          stripeSessionId: sessionId,
          ownerId: req.user.id
        },
        include: { package: true }
      });

      if (purchase) {
        return res.json({
          ok: true,
          paymentType: 'credit_pack',
          purchase: {
            id: purchase.id,
            status: purchase.status,
            units: purchase.package?.units || 0
          }
        });
      }
    }

    // Unknown payment type
    return res.json({
      ok: true,
      paymentType: 'unknown',
      message: 'Payment received, processing...'
    });
  } catch (e) {
    if (e.message?.includes('Stripe is not configured')) {
      return res.status(503).json({ 
        message: 'Payment processing unavailable', 
        code: 'STRIPE_NOT_CONFIGURED' 
      });
    }
    next(e);
  }
});

/**
 * GET /api/billing/verify-sync
 * Verify data consistency between Stripe and local database
 * Checks for orphaned records and mismatched states
 */
r.get('/billing/verify-sync', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const issues = [];

    // Get user's subscription status
    const subscription = await getSubscriptionStatus(userId);
    
    // Check 1: User has active subscription but no stripeSubscriptionId
    if (subscription.active && !subscription.stripeSubscriptionId) {
      issues.push({
        type: 'missing_stripe_subscription_id',
        message: 'User has active subscription status but no Stripe subscription ID',
        severity: 'high'
      });
    }

    // Check 2: User has stripeSubscriptionId but subscription is not active
    if (subscription.stripeSubscriptionId && !subscription.active) {
      issues.push({
        type: 'inactive_with_stripe_id',
        message: 'User has Stripe subscription ID but subscription status is not active',
        severity: 'medium',
        note: 'This may be normal if subscription was cancelled'
      });
    }

    // Check 3: Verify credit transactions match subscription allocations
    if (subscription.active && subscription.planType) {
      // Count subscription credit allocations
      const subscriptionCredits = await prisma.creditTransaction.count({
        where: {
          ownerId: userId,
          reason: {
            startsWith: `subscription:${subscription.planType}:cycle`
          },
          type: 'credit'
        }
      });

      // This is informational - we don't know how many billing cycles have occurred
      // But we can verify the pattern is correct
      if (subscriptionCredits === 0 && subscription.active) {
        issues.push({
          type: 'no_subscription_credits',
          message: `Active ${subscription.planType} subscription but no credit allocations found`,
          severity: 'medium',
          note: 'Credits may be allocated on next billing cycle'
        });
      }
    }

    res.json({
      ok: true,
      userId,
      subscription,
      issues,
      summary: {
        totalIssues: issues.length,
        highSeverity: issues.filter(i => i.severity === 'high').length,
        mediumSeverity: issues.filter(i => i.severity === 'medium').length
      }
    });
  } catch (e) {
    next(e);
  }
});

module.exports = r;
