// In game-backend/middleware/authMiddleware.js

export const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next(); // User is logged in, proceed
  }
  // User is not logged in, send an unauthorized error
  res.status(401).json({ message: 'You must be logged in to do that.' });
};