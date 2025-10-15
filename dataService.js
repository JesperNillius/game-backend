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

// You can remove the mock getLeaderboardForCase function for now