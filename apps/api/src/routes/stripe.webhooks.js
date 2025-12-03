// apps/api/src/routes/stripe.webhooks.js
const express = require('express');
const prisma = require('../lib/prisma');
const { verifyWebhookSignature, getCheckoutSession, stripe } = require('../services/stripe.service');
const { credit } = require('../services/wallet.service');
const {
  allocateFreeCredits,
  activateSubscription,
  deactivateSubscription
  // calculateTopupPrice // Unused - kept for potential future use
} = require('../services/subscription.service');
const pino = require('pino');

const router = express.Router();
const logger = pino({ transport: { target: 'pino-pretty' } });

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Persist webhook event for auditing
 */
async function persistWebhookEvent(eventType, payload, stripeEventId) {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventType,
        payload,
        providerMessageId: stripeEventId || null
      }
    });
  } catch (e) {
    logger.warn({ err: e?.message }, 'Failed to persist Stripe webhook event');
  }
}

/**
 * Handle checkout.session.completed event
 * This is fired when a customer successfully completes a payment
 * Handles both package purchases and subscriptions/credit top-ups
 */
async function handleCheckoutCompleted(session) {
  const metadata = session.metadata || {};
  const ownerId = Number(metadata.ownerId);
  const type = metadata.type; // 'subscription', 'credit_topup', or undefined (package purchase)

  // Handle subscription checkout
  if (type === 'subscription') {
    return handleCheckoutSessionCompletedForSubscription(session);
  }

  // Handle credit top-up checkout
  if (type === 'credit_topup') {
    return handleCheckoutSessionCompletedForTopup(session);
  }

  // Legacy: Handle package purchase
  const packageId = Number(metadata.packageId);
  const units = Number(metadata.units);
  const currency = metadata.currency || 'EUR';

  if (!ownerId || !packageId || !units) {
    logger.warn({ session: session.id }, 'Checkout session missing required metadata');
    return;
  }

  // Find the purchase record
  // First try with all constraints, then fallback to just session ID (for robustness)
  let purchase = await prisma.purchase.findFirst({
    where: {
      stripeSessionId: session.id,
      ownerId,
      packageId,
      status: 'pending'
    },
    include: { package: true }
  });

  // Fallback: find by session ID only (in case metadata doesn't match exactly)
  if (!purchase) {
    purchase = await prisma.purchase.findFirst({
      where: {
        stripeSessionId: session.id,
        status: 'pending'
      },
      include: { package: true }
    });
  }

  if (!purchase) {
    logger.warn({ sessionId: session.id, ownerId, packageId }, 'Purchase record not found for completed checkout');
    return;
  }

  // Validate ownerId matches if we found by session ID only
  if (purchase.ownerId !== ownerId) {
    logger.warn({ 
      sessionId: session.id, 
      purchaseOwnerId: purchase.ownerId, 
      metadataOwnerId: ownerId 
    }, 'Owner ID mismatch in purchase record');
    return;
  }

  // Check if already processed (idempotency)
  if (purchase.status === 'paid') {
    logger.info({ purchaseId: purchase.id }, 'Purchase already processed');
    return;
  }

  // Validate payment amount matches expected amount (fraud prevention)
  const expectedAmountCents = purchase.amountCents;
  const actualAmountCents = session.amount_total || 0;
  
  // Allow small rounding differences (up to 1 cent)
  if (Math.abs(actualAmountCents - expectedAmountCents) > 1) {
    logger.error({ 
      ownerId, 
      sessionId: session.id,
      purchaseId: purchase.id,
      expectedAmountCents, 
      actualAmountCents,
      packageId,
      units
    }, 'Payment amount mismatch - potential fraud or configuration error');
    throw new Error(`Payment amount mismatch: expected ${expectedAmountCents} cents, got ${actualAmountCents} cents`);
  }

  // Update purchase status and link Stripe data
  // Credit wallet atomically within the same transaction
  try {
    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status: 'paid',
          stripePaymentIntentId: session.payment_intent || null,
          stripeCustomerId: session.customer || null,
          updatedAt: new Date()
        }
      });

      // Credit the wallet (pass tx to avoid nested transaction)
      await credit(ownerId, units, {
        reason: `stripe:purchase:${purchase.package.name}`,
        meta: {
          purchaseId: purchase.id,
          packageId: purchase.packageId,
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
          currency
        }
      }, tx);
    });
  } catch (err) {
    logger.error({ 
      err, 
      purchaseId: purchase.id, 
      ownerId, 
      units 
    }, 'Failed to process purchase completion');
    throw err; // Re-throw to be caught by webhook handler
  }

  logger.info({ purchaseId: purchase.id, ownerId, units }, 'Purchase completed and wallet credited');
}

/**
 * Handle payment_intent.succeeded event (backup/alternative)
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  const metadata = paymentIntent.metadata || {};
  const ownerId = Number(metadata.ownerId);
  const packageId = Number(metadata.packageId);

  if (!ownerId || !packageId) {
    // Try to find purchase by payment intent ID
    const purchase = await prisma.purchase.findFirst({
      where: {
        stripePaymentIntentId: paymentIntent.id,
        status: 'pending'
      }
    });

    if (purchase) {
      // Get session to extract metadata
      if (purchase.stripeSessionId) {
        const session = await getCheckoutSession(purchase.stripeSessionId);
        return handleCheckoutCompleted(session);
      }
      // If no session ID, we can't get metadata, skip
      logger.warn({ purchaseId: purchase.id }, 'Purchase has no session ID, cannot process');
    }

    logger.warn({ paymentIntentId: paymentIntent.id }, 'Payment intent missing metadata and no purchase found');
    return;
  }

  // Similar handling as checkout completed
  // First try with all constraints, then fallback to just payment intent ID
  let purchase = await prisma.purchase.findFirst({
    where: {
      stripePaymentIntentId: paymentIntent.id,
      ownerId,
      packageId,
      status: 'pending'
    },
    include: { package: true }
  });

  // Fallback: find by payment intent ID only
  if (!purchase) {
    purchase = await prisma.purchase.findFirst({
      where: {
        stripePaymentIntentId: paymentIntent.id,
        status: 'pending'
      },
      include: { package: true }
    });
  }

  if (!purchase) {
    logger.warn({ paymentIntentId: paymentIntent.id, ownerId, packageId }, 'Purchase not found for payment intent');
    return;
  }

  // Validate ownerId matches if we found by payment intent ID only
  if (purchase.ownerId !== ownerId) {
    logger.warn({ 
      paymentIntentId: paymentIntent.id, 
      purchaseOwnerId: purchase.ownerId, 
      metadataOwnerId: ownerId 
    }, 'Owner ID mismatch in purchase record');
    return;
  }

  if (purchase.status === 'paid') {
    logger.info({ purchaseId: purchase.id }, 'Purchase already processed');
    return;
  }

  const units = purchase.units;
  const currency = purchase.currency || 'EUR';

  try {
    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status: 'paid',
          stripeCustomerId: paymentIntent.customer || null,
          updatedAt: new Date()
        }
      });

      // Credit wallet (pass tx to avoid nested transaction)
      await credit(ownerId, units, {
        reason: `stripe:purchase:${purchase.package.name}`,
        meta: {
          purchaseId: purchase.id,
          packageId: purchase.packageId,
          stripePaymentIntentId: paymentIntent.id,
          currency
        }
      }, tx);
    });
  } catch (err) {
    logger.error({ 
      err, 
      purchaseId: purchase.id, 
      ownerId, 
      units 
    }, 'Failed to process payment intent success');
    throw err; // Re-throw to be caught by webhook handler
  }

  logger.info({ purchaseId: purchase.id, ownerId, units }, 'Payment intent succeeded, wallet credited');
}

/**
 * Handle payment_intent.payment_failed event
 */
async function handlePaymentFailed(paymentIntent) {
  const purchase = await prisma.purchase.findFirst({
    where: {
      stripePaymentIntentId: paymentIntent.id,
      status: 'pending'
    }
  });

  if (purchase) {
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: {
        status: 'failed',
        updatedAt: new Date()
      }
    });
    logger.info({ purchaseId: purchase.id }, 'Purchase marked as failed');
  }
}

/**
 * Handle checkout.session.completed for subscription
 */
async function handleCheckoutSessionCompletedForSubscription(session) {
  const metadata = session.metadata || {};
  const ownerId = Number(metadata.ownerId);
  const planType = metadata.planType;

  if (!ownerId || !planType) {
    logger.warn({ sessionId: session.id }, 'Subscription checkout missing required metadata');
    return;
  }

  if (!['starter', 'pro'].includes(planType)) {
    logger.warn({ sessionId: session.id, planType }, 'Invalid plan type in subscription checkout');
    return;
  }

  // Get subscription ID from session
  const subscriptionId = session.subscription;
  const customerId = session.customer;

  if (!subscriptionId) {
    logger.warn({ sessionId: session.id }, 'Subscription checkout missing subscription ID');
    return;
  }

  try {
    logger.info({ ownerId, planType, subscriptionId, sessionId: session.id }, 'Processing subscription checkout completion');
    
    // Get subscription details from Stripe first (needed for billing period)
    let stripeSubscription = null;
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      logger.debug({ subscriptionId, billingPeriod: stripeSubscription.current_period_start }, 'Retrieved subscription details from Stripe');
    } catch (err) {
      logger.warn({ subscriptionId, err: err.message }, 'Failed to retrieve subscription from Stripe');
    }

    // Activate subscription (sets planType and subscriptionStatus)
    logger.info({ ownerId, planType, subscriptionId }, 'Activating subscription');
    await activateSubscription(ownerId, customerId, subscriptionId, planType);
    logger.info({ ownerId, planType, subscriptionId }, 'Subscription activated successfully');

    // Allocate free credits for first billing cycle
    // Use subscription ID as invoice ID for idempotency (first invoice will be created separately)
    // Pass planType explicitly to avoid race condition with database read
    logger.info({ ownerId, planType, subscriptionId }, 'Allocating free credits for subscription');
    const result = await allocateFreeCredits(ownerId, planType, `sub_${subscriptionId}`, stripeSubscription);
    
    if (!result.allocated) {
      logger.warn({ 
        ownerId, 
        planType, 
        subscriptionId, 
        reason: result.reason,
        credits: result.credits || 0 
      }, 'Free credits not allocated - may already be processed or subscription not active');
    } else {
      logger.info({ 
        ownerId, 
        planType, 
        subscriptionId, 
        credits: result.credits,
        invoiceId: `sub_${subscriptionId}`
      }, 'Subscription activated and free credits allocated successfully');
    }
  } catch (err) {
    logger.error({ 
      ownerId, 
      planType, 
      subscriptionId,
      sessionId: session.id,
      err: err.message, 
      stack: err.stack 
    }, 'Failed to process subscription checkout');
    throw err;
  }
}

/**
 * Handle checkout.session.completed for credit top-up
 */
async function handleCheckoutSessionCompletedForTopup(session) {
  const metadata = session.metadata || {};
  const ownerId = Number(metadata.ownerId);
  const credits = Number(metadata.credits);
  const priceEur = Number(metadata.priceEur);

  if (!ownerId || !credits || !priceEur) {
    logger.warn({ sessionId: session.id }, 'Credit top-up checkout missing required metadata');
    return;
  }

  logger.info({ ownerId, credits, priceEur, sessionId: session.id }, 'Processing credit top-up checkout completion');

  // Validate payment amount matches expected amount (fraud prevention)
  const expectedAmountCents = Math.round(priceEur * 100);
  const actualAmountCents = session.amount_total || 0;
  
  // Allow small rounding differences (up to 1 cent)
  if (Math.abs(actualAmountCents - expectedAmountCents) > 1) {
    logger.error({ 
      ownerId, 
      sessionId: session.id,
      expectedAmountCents, 
      actualAmountCents,
      credits,
      priceEur
    }, 'Payment amount mismatch - potential fraud or configuration error');
    throw new Error(`Payment amount mismatch: expected ${expectedAmountCents} cents, got ${actualAmountCents} cents`);
  }

  // Check if already processed (idempotency)
  const existingTxn = await prisma.creditTransaction.findFirst({
    where: {
      ownerId,
      reason: 'stripe:topup',
      meta: {
        path: ['sessionId'],
        equals: session.id
      }
    }
  });

  if (existingTxn) {
    logger.info({ 
      ownerId, 
      sessionId: session.id,
      transactionId: existingTxn.id,
      credits 
    }, 'Credit top-up already processed (idempotency check)');
    return;
  }

  try {
    logger.debug({ ownerId, credits, priceEur }, 'Adding credits to wallet');
    await prisma.$transaction(async (tx) => {
      // Credit wallet
      await credit(ownerId, credits, {
        reason: 'stripe:topup',
        meta: {
          sessionId: session.id,
          paymentIntentId: session.payment_intent || null,
          customerId: session.customer || null,
          credits,
          priceEur,
          purchasedAt: new Date().toISOString()
        }
      }, tx);
    });

    logger.info({ 
      ownerId, 
      credits, 
      priceEur, 
      sessionId: session.id,
      paymentIntentId: session.payment_intent 
    }, 'Credit top-up processed successfully');
  } catch (err) {
    logger.error({ ownerId, credits, err: err.message, stack: err.stack }, 'Failed to process credit top-up');
    throw err;
  }
}

/**
 * Handle invoice.payment_succeeded event
 * This is fired for subscription renewals and first payment
 */
async function handleInvoicePaymentSucceeded(invoice) {
  logger.info({ invoiceId: invoice.id, billingReason: invoice.billing_reason }, 'Processing invoice payment succeeded');
  
  // Skip subscription_create invoices - they are handled by checkout.session.completed
  // This prevents race conditions where invoice.payment_succeeded fires before checkout.session.completed
  if (invoice.billing_reason === 'subscription_create') {
    logger.debug({ invoiceId: invoice.id, billingReason: invoice.billing_reason }, 'Skipping subscription_create invoice (handled by checkout.session.completed)');
    return;
  }
  
  // Only process subscription_cycle invoices (recurring billing)
  if (invoice.billing_reason !== 'subscription_cycle') {
    logger.debug({ invoiceId: invoice.id, billingReason: invoice.billing_reason }, 'Skipping non-subscription-cycle invoice');
    return;
  }

  const subscriptionId = invoice.subscription;
  const customerId = invoice.customer;

  if (!subscriptionId || !customerId) {
    logger.warn({ invoiceId: invoice.id }, 'Invoice missing subscription or customer ID');
    return;
  }

  logger.debug({ invoiceId: invoice.id, subscriptionId, customerId }, 'Looking up user for invoice');

  // Find user by Stripe customer ID
  const user = await prisma.user.findFirst({
    where: {
      stripeCustomerId: customerId
    },
    select: {
      id: true,
      planType: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true
    }
  });

  if (!user) {
    logger.warn({ customerId, invoiceId: invoice.id }, 'User not found for invoice');
    return;
  }

  // Verify subscription ID matches
  if (user.stripeSubscriptionId !== subscriptionId) {
    logger.warn({ 
      userId: user.id, 
      userSubscriptionId: user.stripeSubscriptionId,
      invoiceSubscriptionId: subscriptionId 
    }, 'Subscription ID mismatch between user and invoice');
    return;
  }

  if (user.subscriptionStatus !== 'active') {
    logger.warn({ 
      userId: user.id, 
      subscriptionStatus: user.subscriptionStatus,
      invoiceId: invoice.id 
    }, 'User subscription not active - skipping credit allocation');
    return;
  }

  // Get subscription details from Stripe
  let stripeSubscription = null;
  try {
    stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    logger.debug({ 
      subscriptionId, 
      billingPeriodStart: stripeSubscription.current_period_start,
      billingPeriodEnd: stripeSubscription.current_period_end
    }, 'Retrieved subscription details from Stripe');
  } catch (err) {
    logger.warn({ subscriptionId, err: err.message }, 'Failed to retrieve subscription from Stripe');
  }

  // Allocate free credits for this billing cycle (idempotent)
  logger.info({ 
    userId: user.id, 
    planType: user.planType, 
    invoiceId: invoice.id,
    subscriptionId 
  }, 'Allocating free credits for billing cycle');
  
  try {
    const result = await allocateFreeCredits(user.id, user.planType, invoice.id, stripeSubscription);
    if (result.allocated) {
      logger.info({ 
        userId: user.id, 
        planType: user.planType, 
        invoiceId: invoice.id, 
        credits: result.credits,
        subscriptionId
      }, 'Free credits allocated successfully for billing cycle');
    } else {
      logger.info({ 
        userId: user.id, 
        invoiceId: invoice.id,
        reason: result.reason,
        credits: result.credits || 0
      }, 'Free credits not allocated (already allocated or other reason)');
    }
  } catch (err) {
    logger.error({ 
      userId: user.id, 
      invoiceId: invoice.id, 
      subscriptionId,
      err: err.message, 
      stack: err.stack 
    }, 'Failed to allocate free credits for invoice');
    throw err;
  }
}

/**
 * Handle invoice.payment_failed event
 * This is fired when a subscription renewal payment fails
 */
async function handleInvoicePaymentFailed(invoice) {
  logger.info({ invoiceId: invoice.id, billingReason: invoice.billing_reason }, 'Processing invoice payment failed');
  
  // Only process subscription invoices
  if (invoice.billing_reason !== 'subscription_cycle' && invoice.billing_reason !== 'subscription_update') {
    logger.debug({ invoiceId: invoice.id, billingReason: invoice.billing_reason }, 'Skipping non-subscription invoice');
    return;
  }

  const subscriptionId = invoice.subscription;
  const customerId = invoice.customer;

  if (!subscriptionId || !customerId) {
    logger.warn({ invoiceId: invoice.id }, 'Invoice missing subscription or customer ID');
    return;
  }

  logger.debug({ invoiceId: invoice.id, subscriptionId, customerId }, 'Looking up user for failed invoice');

  // Find user by Stripe customer ID
  const user = await prisma.user.findFirst({
    where: {
      stripeCustomerId: customerId
    },
    select: {
      id: true,
      planType: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true
    }
  });

  if (!user) {
    logger.warn({ customerId, invoiceId: invoice.id }, 'User not found for failed invoice');
    return;
  }

  // Verify subscription ID matches
  if (user.stripeSubscriptionId !== subscriptionId) {
    logger.warn({ 
      userId: user.id, 
      userSubscriptionId: user.stripeSubscriptionId,
      invoiceSubscriptionId: subscriptionId 
    }, 'Subscription ID mismatch between user and invoice');
    return;
  }

  // Get subscription from Stripe to check current status
  let stripeSubscription = null;
  try {
    stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    logger.debug({ 
      subscriptionId, 
      stripeStatus: stripeSubscription.status
    }, 'Retrieved subscription details from Stripe');
  } catch (err) {
    logger.warn({ subscriptionId, err: err.message }, 'Failed to retrieve subscription from Stripe');
  }

  // Update subscription status based on Stripe status
  // If subscription is past_due or unpaid, mark as inactive
  // If subscription is cancelled, mark as cancelled
  const stripeStatus = stripeSubscription?.status;
  let newStatus = user.subscriptionStatus;
  
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') {
    newStatus = 'inactive';
    logger.info({ 
      userId: user.id, 
      subscriptionId,
      stripeStatus,
      oldStatus: user.subscriptionStatus,
      newStatus
    }, 'Subscription payment failed - marking as inactive');
  } else if (stripeStatus === 'cancelled') {
    newStatus = 'cancelled';
    logger.info({ 
      userId: user.id, 
      subscriptionId,
      stripeStatus,
      oldStatus: user.subscriptionStatus,
      newStatus
    }, 'Subscription cancelled after payment failure');
  }

  // Update subscription status if changed
  if (user.subscriptionStatus !== newStatus) {
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: newStatus }
      });
      logger.info({ 
        userId: user.id, 
        subscriptionId, 
        oldStatus: user.subscriptionStatus, 
        newStatus,
        invoiceId: invoice.id
      }, 'Subscription status updated after payment failure');
    } catch (err) {
      logger.error({ 
        userId: user.id, 
        subscriptionId, 
        err: err.message,
        stack: err.stack
      }, 'Failed to update subscription status after payment failure');
      throw err;
    }
  } else {
    logger.debug({ 
      userId: user.id, 
      subscriptionId,
      status: user.subscriptionStatus,
      stripeStatus
    }, 'Subscription status unchanged after payment failure');
  }
}

/**
 * Handle charge.refunded event
 * This is fired when a payment is refunded
 */
async function handleChargeRefunded(charge) {
  logger.info({ chargeId: charge.id, amount: charge.amount, amountRefunded: charge.amount_refunded }, 'Processing charge refunded event');
  
  const paymentIntentId = charge.payment_intent;
  const customerId = charge.customer;
  
  if (!paymentIntentId) {
    logger.warn({ chargeId: charge.id }, 'Charge missing payment intent ID');
    return;
  }

  // Find credit transaction by payment intent ID
  // Check both credit top-ups and credit pack purchases
  const creditTxn = await prisma.creditTransaction.findFirst({
    where: {
      type: 'credit',
      OR: [
        {
          reason: 'stripe:topup',
          meta: {
            path: ['paymentIntentId'],
            equals: paymentIntentId
          }
        },
        {
          reason: {
            startsWith: 'stripe:purchase:'
          },
          meta: {
            path: ['stripePaymentIntentId'],
            equals: paymentIntentId
          }
        }
      ]
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  if (!creditTxn) {
    logger.warn({ chargeId: charge.id, paymentIntentId }, 'Credit transaction not found for refunded charge');
    return;
  }

  // Calculate credits to deduct (assuming 1 credit = 1 cent, or use metadata if available)
  // For credit top-ups, use the credits amount from metadata
  // For credit packs, use the units from the purchase
  let creditsToDeduct = 0;
  
  if (creditTxn.reason === 'stripe:topup') {
    const meta = creditTxn.meta || {};
    creditsToDeduct = meta.credits || 0;
  } else if (creditTxn.reason?.startsWith('stripe:purchase:')) {
    // For credit packs, find the purchase to get units
    const purchase = await prisma.purchase.findFirst({
      where: {
        stripePaymentIntentId: paymentIntentId,
        ownerId: creditTxn.ownerId
      },
      include: { package: true }
    });
    
    if (purchase && purchase.package) {
      creditsToDeduct = purchase.package.units;
    } else {
      // Fallback: use transaction amount
      creditsToDeduct = creditTxn.amount;
    }
  } else {
    // Fallback: use transaction amount
    creditsToDeduct = creditTxn.amount;
  }

  if (creditsToDeduct <= 0) {
    logger.warn({ chargeId: charge.id, transactionId: creditTxn.id }, 'Invalid credits amount for refund');
    return;
  }

  // Check if already refunded (idempotency)
  const existingRefund = await prisma.creditTransaction.findFirst({
    where: {
      ownerId: creditTxn.ownerId,
      type: 'debit',
      reason: 'stripe:refund',
      meta: {
        path: ['chargeId'],
        equals: charge.id
      }
    }
  });

  if (existingRefund) {
    logger.info({ 
      chargeId: charge.id, 
      transactionId: creditTxn.id,
      refundTransactionId: existingRefund.id
    }, 'Refund already processed (idempotency check)');
    return;
  }

  try {
    logger.info({ 
      ownerId: creditTxn.ownerId, 
      creditsToDeduct, 
      chargeId: charge.id,
      originalTransactionId: creditTxn.id
    }, 'Processing refund - deducting credits');

    const { debit } = require('../services/wallet.service');
    
    await prisma.$transaction(async (tx) => {
      // Debit credits
      await debit(creditTxn.ownerId, creditsToDeduct, {
        reason: 'stripe:refund',
        meta: {
          chargeId: charge.id,
          paymentIntentId,
          customerId,
          originalTransactionId: creditTxn.id,
          originalReason: creditTxn.reason,
          refundedAt: new Date().toISOString()
        }
      }, tx);

      // Update purchase status if it exists
      const purchase = await tx.purchase.findFirst({
        where: {
          stripePaymentIntentId: paymentIntentId,
          ownerId: creditTxn.ownerId
        }
      });

      if (purchase) {
        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            status: 'refunded',
            updatedAt: new Date()
          }
        });
        logger.info({ purchaseId: purchase.id }, 'Purchase marked as refunded');
      }
    });

    logger.info({ 
      ownerId: creditTxn.ownerId, 
      creditsToDeduct, 
      chargeId: charge.id,
      originalTransactionId: creditTxn.id
    }, 'Refund processed successfully - credits deducted');
  } catch (err) {
    logger.error({ 
      ownerId: creditTxn.ownerId, 
      creditsToDeduct, 
      chargeId: charge.id,
      err: err.message, 
      stack: err.stack 
    }, 'Failed to process refund');
    throw err;
  }
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDeleted(subscription) {
  const subscriptionId = subscription.id;
  const customerId = subscription.customer;

  logger.info({ subscriptionId, customerId }, 'Processing subscription deleted event');

  if (!subscriptionId) {
    logger.warn({ subscription }, 'Subscription deleted event missing subscription ID');
    return;
  }

  // Find user by Stripe subscription ID
  const user = await prisma.user.findFirst({
    where: {
      stripeSubscriptionId: subscriptionId
    },
    select: {
      id: true,
      subscriptionStatus: true,
      planType: true
    }
  });

  if (!user) {
    logger.warn({ subscriptionId, customerId }, 'User not found for deleted subscription');
    return;
  }

  logger.info({ 
    userId: user.id, 
    subscriptionId,
    currentStatus: user.subscriptionStatus,
    planType: user.planType
  }, 'Deactivating subscription in local database');

  // Deactivate subscription
  try {
    await deactivateSubscription(user.id, 'cancelled');
    logger.info({ 
      userId: user.id, 
      subscriptionId,
      planType: user.planType
    }, 'Subscription deactivated successfully');
  } catch (err) {
    logger.error({ 
      userId: user.id, 
      subscriptionId, 
      err: err.message,
      stack: err.stack
    }, 'Failed to deactivate subscription');
    throw err;
  }
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdated(subscription) {
  const subscriptionId = subscription.id;
  const customerId = subscription.customer;
  const status = subscription.status;

  logger.info({ subscriptionId, customerId, status }, 'Processing subscription updated event');

  if (!subscriptionId) {
    logger.warn({ subscription }, 'Subscription updated event missing subscription ID');
    return;
  }

  // Find user by Stripe subscription ID
  const user = await prisma.user.findFirst({
    where: {
      stripeSubscriptionId: subscriptionId
    },
    select: {
      id: true,
      subscriptionStatus: true,
      planType: true
    }
  });

  if (!user) {
    logger.warn({ subscriptionId, customerId }, 'User not found for updated subscription');
    return;
  }

  // Extract planType from subscription metadata or price ID
  let newPlanType = user.planType;
  const subscriptionMetadata = subscription.metadata || {};
  const metadataPlanType = subscriptionMetadata.planType;
  
  // Try to get planType from metadata first
  if (metadataPlanType && ['starter', 'pro'].includes(metadataPlanType)) {
    newPlanType = metadataPlanType;
  } else if (subscription.items?.data?.[0]?.price?.id) {
    // Fallback: determine planType from price ID
    const priceId = subscription.items.data[0].price.id;
    const { getStripeSubscriptionPriceId } = require('../services/stripe.service');
    
    // Check which plan this price ID belongs to
    const starterPriceId = getStripeSubscriptionPriceId('starter', 'EUR');
    const proPriceId = getStripeSubscriptionPriceId('pro', 'EUR');
    
    if (priceId === starterPriceId) {
      newPlanType = 'starter';
    } else if (priceId === proPriceId) {
      newPlanType = 'pro';
    }
  }

  // Update subscription status based on Stripe status
  // Stripe statuses: active, past_due, unpaid, cancelled, incomplete, incomplete_expired, trialing, paused
  // Our statuses: active, inactive, cancelled
  let newStatus = 'inactive';
  if (status === 'active' || status === 'trialing') {
    newStatus = 'active';
  } else if (status === 'cancelled' || status === 'unpaid' || status === 'incomplete_expired') {
    newStatus = 'cancelled';
  } else if (status === 'past_due' || status === 'incomplete' || status === 'paused') {
    // Keep as inactive but log for monitoring
    newStatus = 'inactive';
    logger.info({ 
      userId: user.id, 
      subscriptionId, 
      stripeStatus: status,
      currentStatus: user.subscriptionStatus 
    }, 'Subscription in non-active state, setting to inactive');
  }

  // Determine what needs to be updated
  const statusChanged = user.subscriptionStatus !== newStatus;
  const planTypeChanged = newPlanType && user.planType !== newPlanType;

  if (statusChanged || planTypeChanged) {
    logger.info({ 
      userId: user.id, 
      subscriptionId,
      oldStatus: user.subscriptionStatus,
      newStatus,
      oldPlanType: user.planType,
      newPlanType,
      stripeStatus: status
    }, 'Updating subscription status and/or planType');
    
    try {
      const updateData = {};
      if (statusChanged) {
        updateData.subscriptionStatus = newStatus;
      }
      if (planTypeChanged) {
        updateData.planType = newPlanType;
      }
      
      await prisma.user.update({
        where: { id: user.id },
        data: updateData
      });
      logger.info({ 
        userId: user.id, 
        subscriptionId, 
        oldStatus: user.subscriptionStatus, 
        newStatus,
        oldPlanType: user.planType,
        newPlanType
      }, 'Subscription updated successfully');
    } catch (err) {
      logger.error({ 
        userId: user.id, 
        subscriptionId, 
        err: err.message,
        stack: err.stack
      }, 'Failed to update subscription');
      throw err;
    }
  } else {
    logger.debug({ 
      userId: user.id, 
      subscriptionId,
      status: user.subscriptionStatus,
      planType: user.planType,
      stripeStatus: status
    }, 'Subscription status and planType unchanged');
  }
}

/**
 * POST /webhooks/stripe
 * Stripe webhook endpoint
 * Must be configured in Stripe dashboard with the webhook secret
 */
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];

  if (!WEBHOOK_SECRET) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ message: 'Webhook secret not configured', code: 'WEBHOOK_CONFIG_ERROR' });
  }

  if (!signature) {
    return res.status(400).json({ message: 'Missing stripe-signature header', code: 'MISSING_SIGNATURE' });
  }

  let event;
  try {
    event = verifyWebhookSignature(req.body, signature, WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err.message }, 'Stripe webhook signature verification failed');
    return res.status(400).json({ message: `Webhook signature verification failed: ${err.message}`, code: 'INVALID_SIGNATURE' });
  }

  // Persist webhook event (async, don't block)
  persistWebhookEvent(event.type, event.data.object, event.id).catch(() => {});

  // Handle event
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      default:
        logger.debug({ type: event.type }, 'Unhandled Stripe event type');
    }

    // Return 200 to acknowledge successful processing
    res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventType: event.type, errMessage: err.message, errStack: err.stack }, 'Error processing Stripe webhook');
    
    // Determine if error is retryable
    // Retryable errors: database connection issues, temporary service unavailability
    // Non-retryable errors: validation errors, business logic errors, data not found
    const isRetryable = 
      err.message?.includes('ECONNREFUSED') ||
      err.message?.includes('ETIMEDOUT') ||
      err.message?.includes('database') ||
      err.message?.includes('connection') ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ETIMEDOUT';
    
    if (isRetryable) {
      // Return 500 to allow Stripe to retry
      logger.warn({ eventType: event.type, err: err.message }, 'Retryable error - returning 500 for Stripe retry');
      return res.status(500).json({ message: 'Temporary error processing webhook', code: 'WEBHOOK_PROCESSING_ERROR', retryable: true });
    } else {
      // Return 200 for non-retryable errors (acknowledge to prevent infinite retries)
      // Log for manual investigation
      logger.error({ eventType: event.type, err: err.message }, 'Non-retryable error - acknowledging to prevent retries');
      return res.status(200).json({ received: true, message: 'Processing failed but acknowledged', code: 'WEBHOOK_PROCESSING_FAILED', retryable: false });
    }
  }
});

module.exports = router;

