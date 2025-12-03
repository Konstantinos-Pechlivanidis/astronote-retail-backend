// apps/api/src/services/wallet.service.js
const prisma = require('../lib/prisma');
const pino = require('pino');

const logger = pino({ name: 'wallet-service' });

/**
 * Ensure a wallet row exists for the owner. Returns wallet.
 * Uses upsert to avoid race conditions.
 */
exports.ensureWallet = async (ownerId) => {
  return prisma.wallet.upsert({
    where: { ownerId },
    update: {},
    create: { ownerId, balance: 0 }
  });
};

/**
 * Get current balance (ensures wallet exists).
 */
exports.getBalance = async (ownerId) => {
  const w = await exports.ensureWallet(ownerId);
  return w.balance;
};

/**
 * Internal helper to append a transaction & update wallet balance atomically.
 * Can be used within an existing transaction by passing tx parameter.
 */
async function appendTxnAndUpdate(ownerId, delta, type, { reason, campaignId, messageId, meta } = {}, tx = null) {
  const execute = async (client) => {
    const wallet = await client.wallet.upsert({
      where: { ownerId },
      update: {},
      create: { ownerId, balance: 0 },
      select: { id: true, balance: true }
    });

    const newBalance = wallet.balance + delta;
    if (newBalance < 0) {
      logger.warn({ ownerId, currentBalance: wallet.balance, delta, type }, 'Insufficient credits');
      throw new Error('INSUFFICIENT_CREDITS');
    }

    // Update wallet
    await client.wallet.update({
      where: { ownerId },
      data: { balance: newBalance }
    });

    // Insert transaction
    const txn = await client.creditTransaction.create({
      data: {
        ownerId,
        type,
        amount: Math.abs(delta),         // always positive in record
        balanceAfter: newBalance,
        reason: reason || null,
        campaignId: campaignId || null,
        messageId: messageId || null,
        meta: meta || undefined,
        walletId: wallet.id              // Link to wallet for referential integrity
      }
    });

    logger.info({ ownerId, type, amount: Math.abs(delta), balanceAfter: newBalance, reason }, 'Wallet transaction completed');

    return { balance: newBalance, txn };
  };

  // If already in a transaction, use it; otherwise create a new one
  if (tx) {
    return execute(tx);
  } else {
    return prisma.$transaction(execute);
  }
}

/**
 * Credit (top-up/purchase/admin grant). Positive amount.
 * Can be used within an existing transaction by passing tx parameter.
 */
exports.credit = async (ownerId, amount, opts = {}, tx = null) => {
  if (!Number.isInteger(amount) || amount <= 0) {throw new Error('INVALID_AMOUNT');}
  return appendTxnAndUpdate(ownerId, +amount, 'credit', opts, tx);
};

/**
 * Debit (consume). Positive amount. Throws on insufficient credits.
 * Can be used within an existing transaction by passing tx parameter.
 */
exports.debit = async (ownerId, amount, opts = {}, tx = null) => {
  if (!Number.isInteger(amount) || amount <= 0) {throw new Error('INVALID_AMOUNT');}
  return appendTxnAndUpdate(ownerId, -amount, 'debit', opts, tx);
};

/**
 * Refund (give back). Positive amount.
 * Can be used within an existing transaction by passing tx parameter.
 */
exports.refund = async (ownerId, amount, opts = {}, tx = null) => {
  if (!Number.isInteger(amount) || amount <= 0) {throw new Error('INVALID_AMOUNT');}
  return appendTxnAndUpdate(ownerId, +amount, 'refund', opts, tx);
};
