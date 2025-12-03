// apps/api/src/services/subscription.service.js
// Subscription management service

const prisma = require('../lib/prisma');
const { credit } = require('./wallet.service');
const pino = require('pino');

const logger = pino({ name: 'subscription-service' });

// Plan configuration
// Note: Billing periods are configured in Stripe (monthly for Starter, yearly for Pro)
// The priceEur values here are for reference/display purposes only
const PLANS = {
  starter: {
    priceEur: 40,        // €40/month - configured in Stripe as recurring monthly price
    freeCredits: 100,    // 100 credits allocated on each billing cycle (monthly)
    stripePriceIdEnv: 'STRIPE_PRICE_ID_SUB_STARTER_EUR'
  },
  pro: {
    priceEur: 240,       // €240/year - configured in Stripe as recurring yearly price
    freeCredits: 500,    // 500 credits allocated on each billing cycle (yearly)
    stripePriceIdEnv: 'STRIPE_PRICE_ID_SUB_PRO_EUR'
  }
};

// Credit top-up pricing
const CREDIT_PRICE_EUR = 0.045; // Base price per credit
const VAT_RATE = 0.24; // 24% VAT

/**
 * Get free credits for a plan
 * @param {string} planType - 'starter' or 'pro'
 * @returns {number} Number of free credits
 */
function getFreeCreditsForPlan(planType) {
  const plan = PLANS[planType];
  if (!plan) {
    logger.warn({ planType }, 'Unknown plan type');
    return 0;
  }
  return plan.freeCredits;
}

/**
 * Get plan configuration
 * @param {string} planType - 'starter' or 'pro'
 * @returns {Object|null} Plan configuration
 */
function getPlanConfig(planType) {
  return PLANS[planType] || null;
}

/**
 * Check if user has active subscription
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True if subscription is active
 */
async function isSubscriptionActive(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true }
    });
    return user?.subscriptionStatus === 'active';
  } catch (err) {
    logger.error({ userId, err: err.message }, 'Failed to check subscription status');
    return false;
  }
}

/**
 * Get current subscription status
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Subscription status object
 */
async function getSubscriptionStatus(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        planType: true,
        subscriptionStatus: true,
        lastFreeCreditsAllocatedAt: true
      }
    });

    if (!user) {
      return {
        active: false,
        planType: null,
        status: 'inactive'
      };
    }

    return {
      active: user.subscriptionStatus === 'active',
      planType: user.planType,
      status: user.subscriptionStatus,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      lastFreeCreditsAllocatedAt: user.lastFreeCreditsAllocatedAt
    };
  } catch (err) {
    logger.error({ userId, err: err.message }, 'Failed to get subscription status');
    throw err;
  }
}

/**
 * Get billing period start date from Stripe subscription
 * @param {Object} stripeSubscription - Stripe subscription object
 * @param {Date} now - Current date
 * @returns {Date} Billing period start date
 */
function getBillingPeriodStart(stripeSubscription, now = new Date()) {
  if (!stripeSubscription || !stripeSubscription.current_period_start) {
    // If no subscription data, assume monthly billing starting from now
    const start = new Date(now);
    start.setDate(1); // First day of current month
    start.setHours(0, 0, 0, 0);
    return start;
  }

  // Convert Stripe timestamp (seconds) to Date
  return new Date(stripeSubscription.current_period_start * 1000);
}

/**
 * Allocate free credits for a billing cycle (idempotent)
 * @param {number} userId - User ID
 * @param {string} planType - 'starter' or 'pro'
 * @param {string} invoiceId - Stripe invoice ID (for idempotency)
 * @param {Object} stripeSubscription - Stripe subscription object (optional)
 * @returns {Promise<Object>} Result with allocated credits and status
 */
async function allocateFreeCredits(userId, planType, invoiceId, stripeSubscription = null) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        planType: true,
        subscriptionStatus: true,
        lastFreeCreditsAllocatedAt: true
      }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Verify subscription is active (required for credit allocation)
    if (user.subscriptionStatus !== 'active') {
      logger.warn({ userId, subscriptionStatus: user.subscriptionStatus }, 'Subscription not active');
      return { allocated: false, reason: 'subscription_not_active' };
    }
    
    // Trust the planType parameter passed in (it was set by activateSubscription)
    // Only warn if there's a mismatch, but don't block allocation
    if (user.planType && user.planType !== planType) {
      logger.warn({ userId, userPlanType: user.planType, requestedPlanType: planType }, 'Plan type mismatch, but proceeding with requested planType');
    }

    // Get free credits for plan
    const freeCredits = getFreeCreditsForPlan(planType);
    if (freeCredits === 0) {
      logger.warn({ userId, planType }, 'No free credits for plan');
      return { allocated: false, reason: 'no_free_credits' };
    }

    // Check if credits already allocated for current billing period
    const now = new Date();
    let billingPeriodStart = null;

    if (stripeSubscription) {
      billingPeriodStart = getBillingPeriodStart(stripeSubscription, now);
    } else if (user.lastFreeCreditsAllocatedAt) {
      // If no subscription data, assume monthly billing
      // Check if last allocation was in current month
      const lastAllocated = new Date(user.lastFreeCreditsAllocatedAt);
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      
      if (lastAllocated >= currentMonthStart) {
        logger.info({ userId, lastAllocated, currentMonthStart }, 'Credits already allocated for this billing period');
        return { allocated: false, reason: 'already_allocated', credits: freeCredits };
      }
      billingPeriodStart = currentMonthStart;
    }

    // Check idempotency via CreditTransaction (check if invoice already processed)
    if (invoiceId) {
      const existingTxn = await prisma.creditTransaction.findFirst({
        where: {
          ownerId: userId,
          reason: `subscription:${planType}:cycle`,
          meta: {
            path: ['invoiceId'],
            equals: invoiceId
          }
        }
      });

      if (existingTxn) {
        logger.info({ userId, invoiceId }, 'Credits already allocated for this invoice');
        return { allocated: false, reason: 'invoice_already_processed', credits: freeCredits };
      }
    }

    // Allocate credits
    await prisma.$transaction(async (tx) => {
      // Credit wallet
      await credit(userId, freeCredits, {
        reason: `subscription:${planType}:cycle`,
        meta: {
          invoiceId: invoiceId || null,
          planType,
          allocatedAt: now.toISOString(),
          billingPeriodStart: billingPeriodStart ? billingPeriodStart.toISOString() : null
        }
      }, tx);

      // Update last allocated timestamp
      await tx.user.update({
        where: { id: userId },
        data: { lastFreeCreditsAllocatedAt: now }
      });
    });

    logger.info({ userId, planType, freeCredits, invoiceId }, 'Free credits allocated');
    return { allocated: true, credits: freeCredits };
  } catch (err) {
    logger.error({ userId, planType, err: err.message, stack: err.stack }, 'Failed to allocate free credits');
    throw err;
  }
}

/**
 * Activate subscription
 * @param {number} userId - User ID
 * @param {string} stripeCustomerId - Stripe customer ID
 * @param {string} stripeSubscriptionId - Stripe subscription ID
 * @param {string} planType - 'starter' or 'pro'
 * @returns {Promise<Object>} Updated user object
 */
async function activateSubscription(userId, stripeCustomerId, stripeSubscriptionId, planType) {
  try {
    if (!['starter', 'pro'].includes(planType)) {
      throw new Error(`Invalid plan type: ${planType}`);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        stripeCustomerId,
        stripeSubscriptionId,
        planType,
        subscriptionStatus: 'active'
      },
      select: {
        id: true,
        planType: true,
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true
      }
    });

    logger.info({ userId, planType, stripeSubscriptionId }, 'Subscription activated');
    return user;
  } catch (err) {
    logger.error({ userId, err: err.message }, 'Failed to activate subscription');
    throw err;
  }
}

/**
 * Deactivate subscription
 * @param {number} userId - User ID
 * @param {string} reason - Reason for deactivation
 * @returns {Promise<Object>} Updated user object
 */
async function deactivateSubscription(userId, reason = 'cancelled') {
  try {
    const status = reason === 'cancelled' ? 'cancelled' : 'inactive';

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: status
        // Keep stripeCustomerId and stripeSubscriptionId for reference
        // Keep planType for historical reference
      },
      select: {
        id: true,
        planType: true,
        subscriptionStatus: true
      }
    });

    logger.info({ userId, reason, status }, 'Subscription deactivated');
    return user;
  } catch (err) {
    logger.error({ userId, err: err.message }, 'Failed to deactivate subscription');
    throw err;
  }
}

/**
 * Calculate credit top-up price
 * @param {number} credits - Number of credits
 * @returns {Object} Price breakdown
 */
function calculateTopupPrice(credits) {
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new Error('Invalid credits amount');
  }

  const basePrice = credits * CREDIT_PRICE_EUR;
  const vatAmount = basePrice * VAT_RATE;
  const totalPrice = basePrice + vatAmount;

  return {
    credits,
    priceEur: Number(basePrice.toFixed(2)),
    vatAmount: Number(vatAmount.toFixed(2)),
    priceEurWithVat: Number(totalPrice.toFixed(2))
  };
}

module.exports = {
  PLANS,
  CREDIT_PRICE_EUR,
  VAT_RATE,
  getFreeCreditsForPlan,
  getPlanConfig,
  isSubscriptionActive,
  getSubscriptionStatus,
  allocateFreeCredits,
  activateSubscription,
  deactivateSubscription,
  calculateTopupPrice,
  getBillingPeriodStart
};

