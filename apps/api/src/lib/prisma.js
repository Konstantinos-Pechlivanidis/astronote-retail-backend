// Prisma client wrapper (JS)
// Force clear ALL Node.js module cache entries related to Prisma
if (process.env.NODE_ENV !== 'production') {
  // Clear all Prisma-related modules from require cache
  Object.keys(require.cache).forEach(key => {
    if (key.includes('@prisma') || key.includes('.prisma')) {
      delete require.cache[key];
    }
  });
}

const { PrismaClient } = require('@prisma/client');

// Clear cached Prisma client instance to force reload after schema changes
if (process.env.NODE_ENV !== 'production' && global.prisma) {
  try {
    global.prisma.$disconnect();
  } catch (e) {
    // Ignore disconnect errors
  }
  delete global.prisma;
}

// Create new Prisma client instance
const prisma = new PrismaClient();

// Cache in development to avoid multiple instances
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

module.exports = prisma;
