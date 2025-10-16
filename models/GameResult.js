import mongoose from 'mongoose';

const gameResultSchema = new mongoose.Schema({
  playerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  caseId: {
    type: String,
    required: true
  },
  score: {
    type: Number,
    required: true
  },
  actionsTaken: {
    type: [String],
    default: []
  },
  timeTaken: { // We're keeping your timeTaken field
    type: Number 
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  feedback: {
    type: String,
    trim: true
  }
}, { 
  timestamps: true // This automatically adds createdAt and updatedAt
});

const GameResult = mongoose.model('GameResult', gameResultSchema);

export default GameResult;