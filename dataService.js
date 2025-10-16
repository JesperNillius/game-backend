import GameResult from './models/GameResult.js'; // Import the GameResult model

/**
 * Saves a completed game result to the database.
 * @param {object} resultData - The data to save.
 */
export async function saveGameResult(resultData) {
  try {
    console.log('[DataService] Saving game result to database...');
    const newResult = new GameResult(resultData);
    const savedResult = await newResult.save();
    console.log('[DataService] Result saved successfully:', savedResult);
    return savedResult;
  } catch (error) {
    console.error('[DataService] Error saving game result:', error);
    // In a real app, you might want to throw the error
    // so the calling function knows something went wrong.
  }
}

/**
 * Adds a rating to a previously saved game result.
 * @param {string} playerId - The ID of the player.
 * @param {string} caseId - The ID of the case.
 * @param {number} rating - The rating from 1 to 5.
 */
export async function rateGameResult(playerId, caseId, rating, feedback) {
  try {
    console.log(`[DataService] Attempting to rate case ${caseId} for player ${playerId} with ${rating} stars.`);
    
    // Find the most recent game result for this specific player and case
    const resultToUpdate = await GameResult.findOne({
      playerId: playerId,
      caseId: caseId
    }).sort({ createdAt: -1 }); // Get the latest one

    if (resultToUpdate) {
      resultToUpdate.rating = rating;
      if (feedback) {
        resultToUpdate.feedback = feedback;
      }
      await resultToUpdate.save();
      console.log('[DataService] Rating saved successfully:', resultToUpdate);
    }
  } catch (error) {
    console.error('[DataService] Error saving case rating:', error);
  }
}

/**
 * Checks if a user has already rated a specific case.
 * @param {string} playerId - The ID of the player.
 * @param {string} caseId - The ID of the case.
 * @returns {Promise<boolean>} - True if a rated result exists, false otherwise.
 */
export async function checkIfCaseRated(playerId, caseId) {
  try {
    const ratedResult = await GameResult.findOne({
      playerId: playerId,
      caseId: caseId,
      rating: { $exists: true, $ne: null }
    });
    return !!ratedResult;
  } catch (error) {
    console.error('[DataService] Error checking for previous rating:', error);
    return false; // Default to false on error
  }
}
// You can remove the mock getLeaderboardForCase function for now