// In models/GameResult.js

import mongoose from 'mongoose';

const resultSchema = new mongoose.Schema({
  caseId: String,
  playerId: String,
  score: Number,
  actionsTaken: [String],
  timeTaken: Number
});

const GameResult = mongoose.model('GameResult', resultSchema);

export default GameResult;