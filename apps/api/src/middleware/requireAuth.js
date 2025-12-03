const { verifyAccessToken } = require('../lib/jwt');
const pino = require('pino');

const logger = pino({ name: 'requireAuth-middleware' });

module.exports = function requireAuth(req, res, next) {
  // Don't process if response already sent
  if (res.headersSent) {
    return;
  }

  try {
  const hdr = req.headers.authorization || '';
  const [type, token] = hdr.split(' ');
    
    // Check for missing or invalid authorization header
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Missing token' });
    }

    // Verify token
    let p;
    try {
      p = verifyAccessToken(token);
    } catch (jwtError) {
      // JWT verification failed (expired, invalid, etc.)
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Ensure user ID is a number (JWT might return string)
    const userId = typeof p.sub === 'string' ? parseInt(p.sub, 10) : p.sub;
    if (isNaN(userId) || !userId) {
      return res.status(401).json({ message: 'Invalid token: invalid user ID' });
    }

    // Set user on request
    req.user = { 
      id: userId, 
      email: p.email || null, 
      senderName: p.senderName || null, 
      company: p.company || null 
    };
    
    next();
  } catch (err) {
    // Catch any unexpected errors
    if (!res.headersSent) {
      logger.error({ err }, 'Unexpected error in requireAuth middleware');
      return res.status(401).json({ message: 'Authentication failed' });
    }
  }
};
