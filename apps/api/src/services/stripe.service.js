// apps/api/src/services/stripe.service.js
const Stripe = require('stripe');
const pino = require('pino');

const logger = pino({ name: 'stripe-service' });

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  logger.warn('STRIPE_SECRET_KEY not set, Stripe features disabled');
}

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
}) : null;

/**
 * Get Stripe price ID for a package and currency
 * Priority: Package DB field -> Environment variable -> null
 * 
 * @param {string} packageName - Package name
 * @param {string} currency - Currency code (EUR, USD, etc.)
 * @param {Object} packageDb - Optional package object from DB with stripePriceIdEur/stripePriceIdUsd
 * @returns {string|null} Stripe price ID or null
 */
function getStripePriceId(packageName, currency = 'EUR', packageDb = null) {
  const upperCurrency = currency.toUpperCase();
  
  // First priority: Check package DB fields if provided
  if (packageDb) {
    if (upperCurrency === 'USD' && packageDb.stripePriceIdUsd) {
      return packageDb.stripePriceIdUsd;
    }
    if (upperCurrency === 'EUR' && packageDb.stripePriceIdEur) {
      return packageDb.stripePriceIdEur;
    }
  }
  
  // Second priority: Environment variable (format: STRIPE_PRICE_ID_{PACKAGE_NAME}_{CURRENCY})
  const envKey = `STRIPE_PRICE_ID_${packageName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${upperCurrency}`;
  const envPriceId = process.env[envKey];
  if (envPriceId) {return envPriceId;}

  // Fallback: Generic format (STRIPE_PRICE_ID_{CURRENCY})
  const genericKey = `STRIPE_PRICE_ID_${upperCurrency}`;
  return process.env[genericKey] || null;
}

/**
 * Get Stripe subscription price ID for a plan
 * @param {string} planType - 'starter' or 'pro'
 * @param {string} currency - Currency code (EUR, USD, etc.)
 * @returns {string|null} Stripe price ID or null
 */
function getStripeSubscriptionPriceId(planType, currency = 'EUR') {
  const upperCurrency = currency.toUpperCase();
  const envKey = `STRIPE_PRICE_ID_SUB_${planType.toUpperCase()}_${upperCurrency}`;
  return process.env[envKey] || null;
}

/**
 * Get Stripe credit top-up price ID
 * @param {string} currency - Currency code (EUR, USD, etc.)
 * @returns {string|null} Stripe price ID or null
 */
function getStripeCreditTopupPriceId(currency = 'EUR') {
  const upperCurrency = currency.toUpperCase();
  const envKey = `STRIPE_PRICE_ID_CREDIT_TOPUP_${upperCurrency}`;
  return process.env[envKey] || null;
}

/**
 * Create a Stripe checkout session for a package purchase
 * @param {Object} params
 * @param {number} params.ownerId - User/Store ID
 * @param {string} params.userEmail - User email
 * @param {Object} params.package - Package object
 * @param {string} params.currency - Currency code (EUR, USD, etc.)
 * @param {string} params.successUrl - Success redirect URL
 * @param {string} params.cancelUrl - Cancel redirect URL
 * @returns {Promise<Object>} Stripe checkout session
 */
async function createCheckoutSession({
  ownerId,
  userEmail,
  package: pkg,
  currency = 'EUR',
  successUrl,
  cancelUrl
}) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  // Check DB fields first, then environment variables
  const priceId = getStripePriceId(pkg.name, currency, pkg);
  if (!priceId) {
    throw new Error(`Stripe price ID not found for package ${pkg.name} (${currency})`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      ownerId: String(ownerId),
      packageId: String(pkg.id),
      packageName: pkg.name,
      units: String(pkg.units),
      currency: currency.toUpperCase()
    },
    // Allow customer to enter email if not provided
    customer_email: userEmail || undefined,
    // Store ownerId in client_reference_id for easy lookup
    client_reference_id: `owner_${ownerId}`,
    // Expand line items to get price details in response
    expand: ['line_items']
  });

  return session;
}

/**
 * Retrieve a Stripe checkout session
 */
async function getCheckoutSession(sessionId) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
  return stripe.checkout.sessions.retrieve(sessionId);
}

/**
 * Retrieve a Stripe payment intent
 */
async function getPaymentIntent(paymentIntentId) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Create a Stripe checkout session for subscription
 * @param {Object} params
 * @param {number} params.ownerId - User/Store ID
 * @param {string} params.userEmail - User email
 * @param {string} params.planType - 'starter' or 'pro'
 * @param {string} params.currency - Currency code (EUR, USD, etc.)
 * @param {string} params.successUrl - Success redirect URL
 * @param {string} params.cancelUrl - Cancel redirect URL
 * @returns {Promise<Object>} Stripe checkout session
 */
async function createSubscriptionCheckoutSession({
  ownerId,
  userEmail,
  planType,
  currency = 'EUR',
  successUrl,
  cancelUrl
}) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  if (!['starter', 'pro'].includes(planType)) {
    throw new Error(`Invalid plan type: ${planType}`);
  }

  const priceId = getStripeSubscriptionPriceId(planType, currency);
  if (!priceId) {
    throw new Error(`Stripe price ID not found for subscription plan ${planType} (${currency}). Please configure STRIPE_PRICE_ID_SUB_${planType.toUpperCase()}_${currency.toUpperCase()} in your environment variables.`);
  }

  // Verify the price exists and is a recurring price
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.type !== 'recurring') {
      throw new Error(`Price ID ${priceId} is not a recurring price. Subscription plans require recurring prices.`);
    }
    if (!price.recurring) {
      throw new Error(`Price ID ${priceId} does not have recurring configuration.`);
    }
  } catch (err) {
    if (err.type === 'StripeInvalidRequestError' && err.code === 'resource_missing') {
      throw new Error(`Price ID ${priceId} not found in Stripe. Please verify the price ID is correct.`);
    }
    // Re-throw if it's our custom error
    if (err.message?.includes('not a recurring price') || err.message?.includes('does not have recurring')) {
      throw err;
    }
    // For other errors, log but continue (price might still be valid)
    logger.warn({ priceId, err: err.message }, 'Could not verify price type, continuing anyway');
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        ownerId: String(ownerId),
        planType,
        type: 'subscription'
      },
      customer_email: userEmail || undefined,
      client_reference_id: `owner_${ownerId}`,
      subscription_data: {
        metadata: {
          ownerId: String(ownerId),
          planType
        }
      },
      expand: ['line_items', 'subscription']
    });

    return session;
  } catch (err) {
    // Handle Stripe-specific errors
    if (err.type === 'StripeInvalidRequestError') {
      if (err.message?.includes('recurring price')) {
        throw new Error(`The price ID ${priceId} is not configured as a recurring price in Stripe. Please create a recurring price for the ${planType} plan.`);
      }
      throw new Error(`Stripe error: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Create a Stripe checkout session for credit top-up
 * @param {Object} params
 * @param {number} params.ownerId - User/Store ID
 * @param {string} params.userEmail - User email
 * @param {number} params.credits - Number of credits to purchase
 * @param {number} params.priceEur - Price in EUR (including VAT)
 * @param {string} params.currency - Currency code (EUR, USD, etc.)
 * @param {string} params.successUrl - Success redirect URL
 * @param {string} params.cancelUrl - Cancel redirect URL
 * @returns {Promise<Object>} Stripe checkout session
 */
async function createCreditTopupCheckoutSession({
  ownerId,
  userEmail,
  credits,
  priceEur,
  currency = 'EUR',
  successUrl,
  cancelUrl
}) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  // Try to use configured price ID first
  const priceId = getStripeCreditTopupPriceId(currency);
  
  // If no price ID configured, create a one-time payment with custom amount
  if (!priceId) {
    // Create checkout session with custom amount
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: `${credits} SMS Credits`,
              description: `Top-up of ${credits} SMS credits`
            },
            unit_amount: Math.round(priceEur * 100) // Convert EUR to cents (ensure integer)
          },
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        ownerId: String(ownerId),
        credits: String(credits),
        priceEur: String(priceEur),
        type: 'credit_topup'
      },
      customer_email: userEmail || undefined,
      client_reference_id: `owner_${ownerId}_topup_${credits}`,
      expand: ['line_items']
    });

    return session;
  }

  // Use configured price ID
  // IMPORTANT: The price ID must be configured as a per-credit price (unit_amount per credit)
  // If using a fixed-amount price, use custom price_data instead (handled above)
  // Validate price type before using
  let price = null;
  let validatedPriceId = priceId;
  try {
    price = await stripe.prices.retrieve(validatedPriceId);
    if (price.type !== 'one_time') {
      logger.warn({ priceId: validatedPriceId, priceType: price.type }, 'Credit top-up price ID is not a one-time price, falling back to custom price_data');
      // Fall back to custom price_data
      validatedPriceId = null;
    }
  } catch (err) {
    logger.warn({ priceId: validatedPriceId, err: err.message }, 'Failed to retrieve price, falling back to custom price_data');
    validatedPriceId = null;
  }

  // If price validation failed or price ID is invalid, use custom price_data
  if (!validatedPriceId || !price) {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: `${credits} SMS Credits`,
              description: `Top-up of ${credits} SMS credits`
            },
            unit_amount: Math.round(priceEur * 100) // Convert EUR to cents (ensure integer)
          },
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        ownerId: String(ownerId),
        credits: String(credits),
        priceEur: String(priceEur),
        type: 'credit_topup'
      },
      customer_email: userEmail || undefined,
      client_reference_id: `owner_${ownerId}_topup_${credits}`,
      expand: ['line_items']
    });
    return session;
  }

  // Use validated price ID (assumed to be per-credit)
  // NOTE: This assumes the price ID is configured with unit_amount = price per credit in cents
  // If your price ID is for a fixed amount, do not use this path - use custom price_data instead
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price: validatedPriceId,
        quantity: credits // Price is per-credit, so quantity = number of credits
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      ownerId: String(ownerId),
      credits: String(credits),
      priceEur: String(priceEur),
      type: 'credit_topup'
    },
    customer_email: userEmail || undefined,
    client_reference_id: `owner_${ownerId}_topup_${credits}`,
    expand: ['line_items']
  });

  return session;
}

/**
 * Get Stripe customer portal URL
 * @param {string} customerId - Stripe customer ID
 * @param {string} returnUrl - URL to return to after portal session
 * @returns {Promise<string>} Portal URL
 */
async function getCustomerPortalUrl(customerId, returnUrl) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });

  return session.url;
}

/**
 * Cancel a Stripe subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @returns {Promise<Object>} Cancelled subscription
 */
/**
 * Update subscription to a new plan
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {string} newPlanType - 'starter' or 'pro'
 * @returns {Promise<Object>} Updated subscription
 */
async function updateSubscription(subscriptionId, newPlanType) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  if (!['starter', 'pro'].includes(newPlanType)) {
    throw new Error(`Invalid plan type: ${newPlanType}`);
  }

  // Get subscription price ID for the new plan
  const newPriceId = getStripeSubscriptionPriceId(newPlanType, 'EUR');
  if (!newPriceId) {
    throw new Error(`Stripe price ID not found for ${newPlanType} plan`);
  }

  // Retrieve current subscription
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  
  // Update subscription with new price
  const updated = await stripe.subscriptions.update(subscriptionId, {
    items: [{
      id: subscription.items.data[0].id,
      price: newPriceId,
    }],
    proration_behavior: 'always_invoice', // Prorate the change
    metadata: {
      planType: newPlanType,
      updatedAt: new Date().toISOString()
    }
  });

  logger.info({ subscriptionId, newPlanType, newPriceId }, 'Subscription updated');
  return updated;
}

async function cancelSubscription(subscriptionId) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  return stripe.subscriptions.cancel(subscriptionId);
}

/**
 * Verify Stripe webhook signature
 */
function verifyWebhookSignature(payload, signature, secret) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
}

module.exports = {
  stripe,
  createCheckoutSession,
  createSubscriptionCheckoutSession,
  createCreditTopupCheckoutSession,
  getCheckoutSession,
  getPaymentIntent,
  getCustomerPortalUrl,
  updateSubscription,
  cancelSubscription,
  verifyWebhookSignature,
  getStripePriceId,
  getStripeSubscriptionPriceId,
  getStripeCreditTopupPriceId
};

