const prisma = require('../lib/prisma');
const { hashPassword, verifyPassword } = require('../lib/passwords');
const { signAccessToken } = require('../lib/jwt');
const crypto = require('crypto');

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };

async function register({ email, password, senderName, company }) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    throw new Error('Email already in use');
  }
  
  // Validate senderName length (max 11 characters for SMS sender ID)
  if (senderName && senderName.length > 11) {
    throw new Error('senderName must be 11 characters or less (SMS sender ID limit)');
  }
  
  // Validate company length (max 160 characters)
  if (company && company.length > 160) {
    throw new Error('company must be 160 characters or less');
  }
  
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash, senderName, company } });
  
  // Auto-login: generate tokens like login does
  const accessToken = signAccessToken({ sub: user.id, email: user.email, senderName: user.senderName, company: user.company });
  const refreshToken = crypto.randomBytes(64).toString('hex');
  const days = parseInt((process.env.JWT_REFRESH_TTL || '30d').replace('d',''), 10) || 30;
  const expiresAt = addDays(new Date(), days);
  
  await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt } });
  return { user, accessToken, refreshToken, expiresAt };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error('Invalid credentials');
  }

  // Βάλε στο JWT λίγα βασικά (id/email/senderName/company)
  const accessToken = signAccessToken({ sub: user.id, email: user.email, senderName: user.senderName, company: user.company });

  const refreshToken = crypto.randomBytes(64).toString('hex');
  const days = parseInt((process.env.JWT_REFRESH_TTL || '30d').replace('d',''), 10) || 30;
  const expiresAt = addDays(new Date(), days);

  await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt } });
  return { user, accessToken, refreshToken, expiresAt };
}

async function refresh(token) {
  const rec = await prisma.refreshToken.findUnique({ where: { token } });
  if (!rec || rec.revokedAt || rec.expiresAt < new Date()) {
    throw new Error('Invalid or expired refresh token');
  }
  const user = await prisma.user.findUnique({ where: { id: rec.userId } });
  const accessToken = signAccessToken({ sub: user.id, email: user.email, senderName: user.senderName, company: user.company });
  return { accessToken, user };
}

async function logout(token) {
  await prisma.refreshToken.updateMany({ where: { token, revokedAt: null }, data: { revokedAt: new Date() } });
}

module.exports = { register, login, refresh, logout };
