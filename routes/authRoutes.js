// In game-backend/routes/authRoutes.js (Final Corrected Version)

import express from 'express';
import bcrypt from 'bcryptjs';
import passport from 'passport';
import User from '../models/User.js';
import GameResult from '../models/GameResult.js';
import { isAuthenticated } from '../middleware/authMiddleware.js';

const router = express.Router();

// Helper function to safely parse JSON from Excel, which might have formatting errors.
function safeJsonParse(jsonString, defaultValue = []) {
    if (!jsonString || typeof jsonString !== 'string') return defaultValue;
    try {
        const cleanedString = jsonString
            .replace(/,\s*\]/g, ']') // Remove trailing commas from arrays
            .replace(/,\s*\}/g, '}'); // Remove trailing commas from objects
        return JSON.parse(cleanedString);
    } catch (e) {
        // This can be noisy, so let's only log if parsing is truly unexpected.
        // console.error('Failed to parse JSON in authRoutes:', jsonString, e);
        return defaultValue;
    }
}

export default function(gameData) {
    const { allPatients } = gameData;

    // --- POST /register ---
    router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username: username });
        if (existingUser) {
        return res.status(409).json({ message: 'Username already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
        username: username,
        password: hashedPassword
        });

        await newUser.save();
        res.status(201).json({ message: 'User created successfully!' });

    } catch (error) {
        if (error.name === 'ValidationError') {
        return res.status(400).json({ message: error.message });
        }
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
    });

    // --- POST /login ---
    router.post('/login', passport.authenticate('local'), (req, res) => {
    // If this function gets called, authentication was successful.
    console.log('--- LOGIN SUCCESSFUL ---');
    console.log('User object attached by Passport:', req.user);
    console.log('------------------------');

    res.json({
        message: 'Login successful!',
        user: {
        id: req.user.id,
        username: req.user.username
        }
    });
    });

    // --- POST /logout ---
    router.post('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.json({ message: 'Logout successful.' });
    });
    });

    // --- GET /status (for debugging) ---
    router.get('/status', isAuthenticated, (req, res) => {
    res.json({ user: req.user });
    });

    // --- GET /history (for fetching user's past game results) ---
    router.get('/history', isAuthenticated, async (req, res) => {
        try {
            const results = await GameResult.find({ playerId: req.user.id }).sort({ _id: -1 });

            const history = results.map(result => {
                const patientData = allPatients.find(p => p.originalIndex == result.caseId);
                if (!patientData) return null;

                return {
                    patientName: patientData.name,
                    patientAge: patientData.age,
                    contactReason: patientData.Kontaktorsak,
                    finalDiagnosis: patientData.Diagnosis,
                    score: result.score,
                    actionsTaken: result.actionsTaken || [],
                    patientAvatar: patientData.patient_avatar,
                    solutionActions: {
                        critical: safeJsonParse(patientData.ActionsCritical, []),
                        recommended: safeJsonParse(patientData.ActionsRecommended, [])
                    }
                };
            }).filter(Boolean); // Filter out any nulls if a patient wasn't found

            res.json(history);
        } catch (error) {
            console.error('Error fetching case history:', error);
            res.status(500).json({ message: 'Server error fetching history.' });
        }
    });

    // --- GET /settings ---
    router.get('/settings', isAuthenticated, (req, res) => {
        res.json({
            showOnLeaderboard: req.user.showOnLeaderboard
        });
    });

    // --- POST /settings ---
    router.post('/settings', isAuthenticated, async (req, res) => {
        try {
            const { showOnLeaderboard } = req.body;

            // Find the user and update their setting
            const user = await User.findById(req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found.' });

            user.showOnLeaderboard = !!showOnLeaderboard; // Coerce to boolean
            await user.save();

            res.json({ message: 'Settings updated successfully.', settings: { showOnLeaderboard: user.showOnLeaderboard } });
        } catch (error) {
            console.error('Error updating settings:', error);
            res.status(500).json({ message: 'Server error while updating settings.' });
        }
    });

    // --- GET /leaderboard ---
    router.get('/leaderboard', async (req, res) => {
        try {
            const leaderboardData = await GameResult.aggregate([
                // Stage 1: Convert the string playerId to a MongoDB ObjectId
                {
                    $addFields: {
                        "playerIdObj": { "$toObjectId": "$playerId" }
                    }
                },
                // Stage 2: Group results by player and calculate stats
                {
                    $group: {
                        _id: "$playerIdObj",
                        avgScore: { $avg: "$score" },
                        casesPlayed: { $sum: 1 }
                    }
                },
                // Stage 3: Join with the users collection to get usernames
                {
                    $lookup: {
                        from: 'users', // The name of the users collection
                        localField: '_id',
                        foreignField: '_id',
                        as: 'playerInfo'
                    }
                },
                // Stage 4: Filter out users who have opted out or have been deleted
                { 
                    $match: { 
                        "playerInfo.showOnLeaderboard": { $ne: false } 
                    } 
                },
                // Stage 5: Sort by average score descending, then cases played descending
                { $sort: { avgScore: -1, casesPlayed: -1 } },
                // Stage 6: Format the final output
                { $project: { _id: 0, username: { $arrayElemAt: ["$playerInfo.username", 0] }, avgScore: { $round: ["$avgScore", 0] }, casesPlayed: 1 } }
            ]);
            res.json(leaderboardData);
        } catch (error) {
            console.error('Error fetching leaderboard data:', error);
            res.status(500).json({ message: 'Server error fetching leaderboard.' });
        }
    });

    return router;
}