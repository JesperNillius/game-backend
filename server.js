// --- 1. IMPORTS ---
import express from "express";
import mongoose from 'mongoose';
import session from 'express-session';
import passport from 'passport';
import LocalStrategy from 'passport-local';
import bcrypt from 'bcryptjs';
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import XLSX from "xlsx";
import path from 'path';
import { fileURLToPath } from 'url';
import MongoStore from 'connect-mongo';

import User from './models/User.js';
import * as dataService from './dataService.js';
import createAuthRouter from './routes/authRoutes.js';
import createGameRouter from './routes/gameRoutes.js';
import createPatientRouter from './routes/patientRoutes.js';
import { isAuthenticated } from "./middleware/authMiddleware.js";


// --- 2. INITIAL SETUP ---
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// --- 3. DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB Atlas!'))
  .catch(error => console.error('Error connecting to MongoDB Atlas:', error));


// --- 4. MIDDLEWARE SETUP (Order is Critical) ---
app.use(express.json());

// --- CORS Configuration for Live and Local ---
const allowedOrigins = [
  'http://127.0.0.1:5500', // Local frontend (using IP)
  'http://localhost:5500',   // Local frontend (using localhost)
  process.env.FRONTEND_URL   // Your live Render frontend URL
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Trust proxy only when running in production (on Render)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// --- Session Configuration ---
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' 
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Serve static files from the 'public' directory, making files in 'public/images' available under '/images'
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// --- Favicon Handling ---
app.get('/favicon.ico', (req, res) => {
  // Assuming you have a favicon.ico in your /public/images/ folder
  res.sendFile(path.join(__dirname, 'public', 'images', 'favicon.ico'));
});

// --- 5. PASSPORT STRATEGY CONFIGURATION ---
passport.use(new LocalStrategy.Strategy(
  async (username, password, done) => {
    try {
      const user = await User.findOne({ username: username });
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  console.log(`--- SERIALIZING USER --- (Saving user ID to session: ${user.id})`);
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    // ✅ Add a check to prevent errors if the user is not found
    if (user) {
      console.log(`--- DESERIALIZING USER --- (Finding user by ID: ${id})`);
    } else {
      console.log(`--- DESERIALIZING USER --- (User with ID: ${id} NOT FOUND)`);
    }
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// --- 6. HELPER FUNCTIONS ---
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function loadDataFromFile(filename, options = {}) {
  const workbook = XLSX.readFile(path.join(__dirname, filename));
  // ✅ Check if a specific sheet name is provided in options, otherwise default to the first one.
  const sheetName = options.sheet || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Important: The sheet_to_json function takes different options.
  // We should pass only the relevant ones, like `range`.
  return XLSX.utils.sheet_to_json(sheet, { range: options.range });
}

// --- NEW: Data Validation Helper ---
function validatePatientData(patients) {
    console.log("\n--- Validating Patient Data ---");
    let errorCount = 0;

    const jsonFields = ['ActionsCritical', 'ActionsRecommended', 'ActionsContraindicated', 'AnamnesisChecklist', 'AdmissionPlanSolution', 'PrescriptionsSolution'];

    patients.forEach((patient, index) => {
        const patientIdentifier = `Patient #${index + 1} (Name: ${patient.name || 'N/A'})`;

        // Check for required fields
        if (!patient.name) {
            console.error(`[VALIDATION ERROR] ${patientIdentifier}: Missing required 'name' field.`);
            errorCount++;
        }
        if (!patient.Diagnosis) {
            console.error(`[VALIDATION ERROR] ${patientIdentifier}: Missing required 'Diagnosis' field.`);
            errorCount++;
        }

        // Check JSON fields for syntax errors
        jsonFields.forEach(field => {
            if (patient[field] && typeof patient[field] === 'string') {
                try {
                    JSON.parse(patient[field].replace(/,\s*([\]}])/g, '$1'));
                } catch (e) {
                    console.error(`[VALIDATION ERROR] ${patientIdentifier}: Invalid JSON in column '${field}'. Please check for syntax errors like trailing commas or mismatched quotes.`);
                    errorCount++;
                }
            }
        });
    });

    if (errorCount === 0) {
        console.log("✅ All patient data seems to be formatted correctly.");
    } else {
        console.error(`❌ Found ${errorCount} formatting errors. Please check the messages above.`);
    }
    console.log("-----------------------------\n");
}

// --- 7. DATA LOADING ---
let allPatients = [], availablePatients = [], allMedications = [], allPrescriptions = [], allLabTests = [], allLabKits = [];
let allRadiologyTests = [], allBedsideTests = [], allPhysicalExams = [], standardFindings = {};
const activePatients = {};

try {
    allMedications = XLSX.utils.sheet_to_json(XLSX.readFile(path.join(__dirname, "medications.xlsx")).Sheets['Blad1']).map(med => {
        try {
            if (med.doseOptions) med.doseOptions = JSON.parse(med.doseOptions);
            if (med.effects) med.effects = JSON.parse(med.effects);
            if (med.therapy_params) med.therapy_params = JSON.parse (med.therapy_params);
        } catch (e) { console.error(`Error parsing JSON for med: ${med.id}`, e); }
        return med;
    });
    console.log(`[SERVER LOG] Loaded ${allMedications.length} medications.`);

    // --- Other Data Files ---
    allLabTests = loadDataFromFile("lab_tests.xlsx");
    allLabKits = loadDataFromFile("lab_tests.xlsx", { sheet: 'LabKits' });
    console.log('--- Raw Lab Kits from Excel: ---', allLabKits); // Add this line
    allPrescriptions = loadDataFromFile("medications.xlsx", { sheet: 'Prescriptions' });
    allRadiologyTests = loadDataFromFile("radiology_tests.xlsx");
    allBedsideTests = loadDataFromFile("bedside_tests.xlsx");
    allPhysicalExams = loadDataFromFile("physical_exams.xlsx");
    standardFindings = {};
    allPhysicalExams.forEach(exam => {
      standardFindings[exam.name] = exam.normalFinding;
    });

    // --- 2. PROCESS PATIENT DATA ---
    const rawPatientData = loadDataFromFile("patients.xlsx", { range: 1 });
    
    // --- ✅ VALIDATE THE RAW DATA ---
    validatePatientData(rawPatientData);


    // Filter, map, and assign to the master 'allPatients' list in one step
    allPatients = rawPatientData
      .filter(patient => patient.name && String(patient.name).trim() !== '')
      .map((patient, index) => ({
        ...patient,
        originalIndex: index,
      }));

    // Create the shuffled list for the game from the now-populated 'allPatients'
    availablePatients = shuffle([...allPatients]);

    // --- ✅ NEW: DATA LOAD SUMMARY ---
    console.log("\n--- Game Data Loaded ---");
    console.log(`- ${allPatients.length} Patients`);
    console.log(`- ${allMedications.length} Medications`);
    console.log(`- ${allPrescriptions.length} Prescriptions`);
    console.log(`- ${allLabTests.length} Lab Tests`);
    console.log(`- ${allRadiologyTests.length} Radiology Exams`);
    console.log(`- ${allBedsideTests.length} Bedside Tests`);
    console.log(`- ${allPhysicalExams.length} Physical Exams`);
    console.log("------------------------\n");
    // ---

    } catch (error) {
        console.error("❌ A CRITICAL ERROR occurred during data loading:", error);
        // Exit the process if data loading fails, so the server doesn't run in a broken state.
        process.exit(1);
}

const allDiagnoses = [...new Set(allPatients.map(p => p.Diagnosis).filter(Boolean))];
console.log(`- ${allDiagnoses.length} Unique Diagnoses`);

// --- 8. API ROUTERS (MUST be last) ---
const gameData = { 
    availablePatients,
    allPatients, 
    allDiagnoses,
    activePatients, 
    allMedications, 
    allLabTests,
    allPrescriptions,
    allLabKits,
    allBedsideTests,
    allRadiologyTests,
    allPhysicalExams,
    standardFindings, 
    openai
};
const gameHelpers = {
    shuffle,
    saveGameResult: dataService.saveGameResult,
    rateGameResult: dataService.rateGameResult,
    checkIfCaseRated: dataService.checkIfCaseRated
};

app.use('/api/auth', createAuthRouter(gameData));
app.use('/api', createGameRouter(gameData, gameHelpers));
app.use('/api/patient', createPatientRouter(gameData, gameHelpers));

// --- 9. ERROR HANDLING MIDDLEWARE (Add this after routers) ---
app.use((err, req, res, next) => {
  console.error(err.stack); // Log the full error for debugging
  res.status(500).json({ error: 'Something went wrong on the server!' });
});

// --- 10. START SIMULATION LOOP & SERVER ---
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT} and on your local network.`));