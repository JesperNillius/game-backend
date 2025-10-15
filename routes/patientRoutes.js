import express from 'express';
import { getVitalColor } from '../simulationHelpers.js';
const router = express.Router();

// --- PRIVATE HELPER FUNCTION ---
function calculateEgfr(creatinineUmoll, age, sex) {
  // CKD-EPI 2021 formula for eGFR
  if (!creatinineUmoll || !age || !sex) return 'N/A';

  const creatinineMgdl = parseFloat(creatinineUmoll) / 88.4;
  const kappa = (sex === 'Kvinna') ? 0.7 : 0.9;
  const alpha = (sex === 'Kvinna') ? -0.329 : -0.411;
  const sexFactor = (sex === 'Kvinna') ? 1.018 : 1.0;
  const term1 = Math.min(creatinineMgdl / kappa, 1) ** alpha;
  const term2 = Math.max(creatinineMgdl / kappa, 1) ** -1.209;
  const ageFactor = 0.993 ** age;
  const egfr = 141 * term1 * term2 * ageFactor * sexFactor;
  
  return Math.round(egfr);
}

export default function(gameData, helpers) {
    const { activePatients, allLabTests, allLabKits, allBedsideTests, allMedications, allRadiologyTests, standardFindings, openai } = gameData;
    const {  } = helpers;

    // Middleware to find active patient
    const findPatient = (req, res, next) => {
        const patient = activePatients[req.params.id];
        if (patient) {
            req.patient = patient;
            next();
        } else {
            res.status(404).json({ error: 'Patient not found in active simulation.' });
        }
    };

    // Status
    router.get('/:id/status', (req, res) => {
        const patientId = req.params.id;
        const patient = activePatients[patientId];
    
        if (patient) {
            // Create a color map for the vitals based on the patient's age
            const vitalColors = {
                AF: getVitalColor('AF', patient.currentVitals.AF, patient.age),
                Saturation: getVitalColor('Saturation', patient.currentVitals.Saturation, patient.age),
                Puls: getVitalColor('Puls', patient.currentVitals.Puls, patient.age),
                BT: getVitalColor('BT_systolic', patient.currentVitals.BT_systolic, patient.age),
                Temp: getVitalColor('Temp', patient.currentVitals.Temp, patient.age),
                RLS: getVitalColor('RLS', patient.currentVitals.RLS, patient.age),
            };
    
            res.json({ 
                vitals: patient.currentVitals,
                vitalColors: vitalColors, // Send the new color map
                isFailed: patient.isFailed, 
                isCritical: patient.isCritical,
                triageLevel: patient.triageLevel
            });
        } else {
            res.status(404).json({ error: 'Patient not found in active simulation.' });
        }
    });

    //Status
    router.post('/:id/perform-exam', async (req, res) => {
    try {
        const patientId = req.params.id;
        const { examId } = req.body; // e.g., "Abdomen", "Neurology"

        const patient = activePatients[patientId];

        if (!patient) {
        return res.status(404).json({ error: 'Patient not found.' });
        }

        // --- Server-Side Finding Generation ---
        const specificFinding = patient[examId];
        const normalFinding = standardFindings[examId];
        
        const resultFinding = specificFinding || normalFinding || "No findings.";

        // Send the official finding back to the client
        res.json({
        examName: examId,
        finding: resultFinding
        });

    } catch (err) {
        console.error(`Error performing physical exam:`, err);
        res.status(500).json({ error: 'Server error while performing exam.' });
    }
    });

    //bedside
    router.post('/:id/perform-bedside', async (req, res) => {
    try {
        const patientId = req.params.id;
        const { testId } = req.body; // e.g., "ekg", "urinsticka"

        const patient = activePatients[patientId];
        const testInfo = allBedsideTests.find(t => t.id === testId);

        if (!patient || !testInfo) {
        return res.status(404).json({ error: 'Patient or bedside test not found.' });
        }

        let resultText;
        // --- NEW: Special handling for bladderscan ---
        if (testId === 'bladderscan') {
            // Use the new 'urinmängd' property, which has a default value.
            resultText = `Bladdervolym ${patient.urinmängd} ml`;
        } else if (testId === 'KAD') {
            // ✅ NEW: Special handling for inserting a catheter
            const urineVolume = patient.urinmängd;
            const urineAppearance = patient['Sätt KAD'] || 'ljusgul'; // Default to 'ljusgul'
            resultText = `KAD satt, tömt ${urineVolume} ml ${urineAppearance} urin.`;
            // After emptying the bladder, set the volume to 0
            patient.urinmängd = 0;
        } else {
            // --- Existing logic for other bedside tests ---
            const specificFindingKey = (testId === 'ekg') ? 'EKG_finding_text' : testInfo.name;
            const specificFinding = patient[specificFindingKey];
            resultText = specificFinding || testInfo.normalFinding;
        }

        res.json({
        testId: testInfo.id,
        testLabel: testInfo.resultLabel || testInfo.name,
        result: resultText,
        // ✅ CORRECTED LOGIC:
        // Only include the EKG filename if the requested test IS 'ekg'.
        imageFilename: (testId === 'ekg') ? (patient.EKG_image_filename || null) : null
        });

    } catch (err) {
        console.error(`Error performing bedside test:`, err);
        res.status(500).json({ error: 'Server error while performing bedside test.' });
    }
    });

    //Radiologi
    router.post('/:id/order-radiology', async (req, res) => {
    try {
        const patientId = req.params.id;
        const { testId } = req.body; // e.g., "dt-thorax", "ul-njurar"

        const patient = activePatients[patientId];
        const testInfo = allRadiologyTests.find(t => t.id === testId);

        if (!patient || !testInfo) {
        return res.status(404).json({ error: 'Patient or radiology test not found.' });
        }

        // --- Server-Side Result Generation ---
        const specificFinding = patient[testInfo.id];
        const resultText = specificFinding || testInfo.normalFinding;

        // Send the official interpretation back to the client
        res.json({
        testId: testInfo.id,
        testName: testInfo.name,
        result: resultText
        });

    } catch (err) {
        console.error(`Error ordering radiology:`, err);
        res.status(500).json({ error: 'Server error while ordering radiology.' });
    }
    });

    //Lab
    router.post('/:id/order-lab', async (req, res) => {
    try {
        const patientId = req.params.id;
        const { testId } = req.body;
        const patient = activePatients[patientId];
        const testInfo = allLabTests.find(t => t.id === testId);

        if (!patient || !testInfo) {
        return res.status(404).json({ error: 'Patient or test info not found.' });
        }

        if (!patient.orderedLabs) patient.orderedLabs = {};

        // --- NEW: Handle delayed vs. immediate results ---
        if (testInfo.resultType === 'delayed') {
            patient.orderedLabs[testId] = {
                name: testInfo.name,
                result: '(Ordered)', // The text to display for delayed tests
                isAbnormal: false    // Not considered abnormal
            };
        } else {
            // --- This is the existing logic for immediate results ---
            const rawValue = patient[testInfo.name];
            const resultText = rawValue ? `${rawValue} ${testInfo.normalRange_unit || ''}`.trim() : "N/A";
            
            let isAbnormal = true;
            const resultValue = parseFloat(rawValue);
            const minNormal = parseFloat(testInfo.normalRange_min);
            const maxNormal = parseFloat(testInfo.normalRange_max);
            if (!isNaN(resultValue) && !isNaN(minNormal) && !isNaN(maxNormal)) {
                if (resultValue >= minNormal && resultValue <= maxNormal) isAbnormal = false;
            }
            patient.orderedLabs[testId] = {
                name: testInfo.name,
                result: resultText,
                isAbnormal: isAbnormal
            };
        }

       if (testId === 'arteriell blodgas') {
            // Get simulated values
            const pco2Value = patient.pCO2 || 5.5; 
            const po2Value = patient.PO2 || 10.0;
            const phValue = 7.38; 
            const beValue = 0.5;

            // Define reference intervals
            const ref = {
                ph: { min: 7.35, max: 7.45 },
                pco2: { min: 4.7, max: 6.0 },
                po2: { min: 10.0, max: 13.0 },
                be: { min: -2.0, max: 2.0 }
            };

            // Check each component
            const isPhAbnormal = phValue < ref.ph.min || phValue > ref.ph.max;
            const isPco2Abnormal = pco2Value < ref.pco2.min || pco2Value > ref.pco2.max;
            const isPo2Abnormal = po2Value < ref.po2.min || po2Value > ref.po2.max;
            const isBeAbnormal = beValue < ref.be.min || beValue > ref.be.max;

            // ✅ Create a structured data object instead of an HTML string
            const resultData = {
                isPanel: true, // A flag for the frontend to identify this special result
                components: [
                    { label: 'pH:', value: phValue.toFixed(2), isAbnormal: isPhAbnormal },
                    { label: 'pCO₂:', value: `${pco2Value.toFixed(1)} kPa`, isAbnormal: isPco2Abnormal },
                    { label: 'PO₂:', value: `${po2Value.toFixed(1)} kPa`, isAbnormal: isPo2Abnormal },
                    { label: 'BE:', value: `${beValue.toFixed(1)} mmol/L`, isAbnormal: isBeAbnormal }
                ]
            };
            
            // The overall test is abnormal if any component is
            const isOverallAbnormal = isPhAbnormal || isPco2Abnormal || isPo2Abnormal || isBeAbnormal;

            patient.orderedLabs[testId] = {
                name: testInfo.name,
                result: resultData, // The result is now an object
                isAbnormal: isOverallAbnormal
            };
        } 


        // --- ✅ If the test is creatinine, also calculate and add eGFR ---
        if (testId === 'krea') {
            const rawValue = patient[testInfo.name];
            const egfrValue = calculateEgfr(rawValue, patient.age, patient.Kön);
            patient.orderedLabs['egfr_calculated'] = { 
                name: 'eGFR', 
                result: `${egfrValue} mL/min/1.73 m²`, 
                isAbnormal: egfrValue < 60 
            };
        }
        
        // ✅ Respond with the entire, updated list of labs for this patient
        res.json(patient.orderedLabs);

    } catch (err) {
        console.error(`Error ordering lab test:`, err);
        res.status(500).json({ error: 'Server error while ordering lab test.' });
    }
    });

    // Lab Kit
    router.post('/:id/order-lab-kit', async (req, res) => {
        try {
            const patientId = req.params.id;
            const { kitId } = req.body;
            const patient = activePatients[patientId];
            
            // Find the kit from the globally loaded data
            const kitInfo = allLabKits.find(k => k.id === kitId);

            if (!patient || !kitInfo) {
                return res.status(404).json({ error: 'Patient or lab kit not found.' });
            }

            const testIds = kitInfo.tests.split(',').map(id => id.trim());


            // Process each test in the kit
            testIds.forEach(testId => {
                const testInfo = allLabTests.find(t => t.id === testId);
                if (!testInfo) return; // Skip if a test ID is invalid

                // This logic is copied from the single /order-lab route
                const rawValue = patient[testInfo.name];
                const resultText = rawValue ? `${rawValue} ${testInfo.normalRange_unit || ''}`.trim() : "N/A";
                
                let isAbnormal = true;
                const resultValue = parseFloat(rawValue);
                const minNormal = parseFloat(testInfo.normalRange_min);
                const maxNormal = parseFloat(testInfo.normalRange_max);
                if (!isNaN(resultValue) && !isNaN(minNormal) && !isNaN(maxNormal)) {
                    if (resultValue >= minNormal && resultValue <= maxNormal) isAbnormal = false;
                }
                
                if (!patient.orderedLabs) patient.orderedLabs = {};
                patient.orderedLabs[testId] = {
                    name: testInfo.name,
                    result: resultText,
                    isAbnormal: isAbnormal
                };
            });
            if (testIds.includes('krea')) {
                // We need the 'krea' test's full info to get its name (e.g., "P-Kreatinin")
                const kreaTestInfo = allLabTests.find(t => t.id === 'krea');
                if (kreaTestInfo) {
                    const rawValue = patient[kreaTestInfo.name];
                    const egfrValue = calculateEgfr(rawValue, patient.age, patient.Kön);
                    patient.orderedLabs['egfr_calculated'] = {
                        name: 'eGFR',
                        result: `${egfrValue} mL/min/1.73 m²`,
                        isAbnormal: egfrValue < 60
                    };
                }
            }
            
            // Respond with the entire, updated list of labs
            res.json(patient.orderedLabs);

        } catch (err) {
            console.error(`Error ordering lab kit:`, err);
            res.status(500).json({ error: 'Server error while ordering lab kit.' });
        }
    });    

    //Medicinering
    router.post('/:id/give-med', (req, res) => {
    const patientId = req.params.id;
    const { medId, dose } = req.body; // Now expects a 'dose' from the frontend

    const patient = activePatients[patientId];
    const medication = allMedications.find(m => m.id === medId);

    if (patient && medication && dose) {
        // Calculate how many times the standard dose was given
        const doseMultiplier = dose / medication.standardDose;

        if (medication.effects) {
        medication.effects.forEach(baseEffect => {
            // Create a new effect with the change value scaled by the dose
            const newEffect = {
            ...baseEffect,
            change: baseEffect.change * doseMultiplier,
            remaining: baseEffect.duration
            };
            patient.activeEffects.push(newEffect);
        });
        }

        if (medication.aiEffectDescription) {
        patient.activeEffects.push({
            target: 'ai',
            description: medication.aiEffectDescription.text,
            duration: medication.aiEffectDescription.duration,
            remaining: medication.aiEffectDescription.duration
        });
        }

        console.log(`--- EFFECT ADDED to patient ${patientId} ---`);
        console.log('Current active effects:', patient.activeEffects);
        console.log('------------------------------------');

        // Send back a more informative message
        res.json({ message: `${medication.name} ${dose}${medication.doseUnit} administered.` });
    } else {
        res.status(404).json({ error: 'Patient, medication, or dose not found.' });
    }
    });

    //Fortsatta medicineringar (O2)
    router.post('/:id/set-therapy', (req, res) => {
    const patientId = req.params.id;
    const { therapyId, value } = req.body; // e.g., therapyId: 'oxygen', value: 2 (L/min)
    const patient = activePatients[patientId];

    if (!patient) {
        return res.status(404).json({ error: 'Patient not found.' });
    }

    if (!patient.activeTherapies) {
        patient.activeTherapies = {};
    }

    if (value > 0) {
        // Set or update the active therapy
        patient.activeTherapies[therapyId] = { flowRate: value };
        console.log(`[THERAPY] Oxygen for patient ${patientId} set to ${value} L/min.`);
    } else {
        // A value of 0 means the therapy is stopped
        delete patient.activeTherapies[therapyId];
        console.log(`[THERAPY] Oxygen for patient ${patientId} stopped.`);
    }

    res.json({ message: 'Therapy updated successfully.' });
    });

    router.post('/:id/toggle-homemed', (req, res) => {
        const patient = activePatients[req.params.id];
        const { medId } = req.body;

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        if (!patient.homeMedicationState) {
            patient.homeMedicationState = {};
        }

        if (!patient.homeMedicationState[medId]) {
            patient.homeMedicationState[medId] = { paused: false };
        }

        // Toggle the paused state
        patient.homeMedicationState[medId].paused = !patient.homeMedicationState[medId].paused;

        console.log(`[MEDS] Patient ${patient.id}: Toggled ${medId}. New state: ${patient.homeMedicationState[medId].paused ? 'PAUSED' : 'ACTIVE'}`);

        // Respond with the updated state so the frontend can sync
        res.json({ homeMedicationState: patient.homeMedicationState });
    });

    return router;
}
