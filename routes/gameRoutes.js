import express from 'express';
import { calculateAgeTriageLevel } from '../simulationHelpers.js';


const router = express.Router();

export default function(gameData, helpers) {
    const { 
    allLabTests, allBedsideTests, allMedications, allRadiologyTests, 
    standardFindings, allPhysicalExams, activePatients, allPatients, availablePatients
    } = gameData;     

    const { shuffle, saveGameResult, checkIfCaseRated } = helpers;

    const criticalThresholds = {
        BT_systolic: { lower: 70 }, // Fails if systolic BP is below 70
        Saturation: { lower: 85 },   // Fails if SpO2 is below 85%
        Puls: { lower: 40, upper: 180 }, // Fails if pulse is outside this range
        'P-Glukos': { lower: 2 } // You can add other values like 'P-Glukos' here later
    };
    const CRITICAL_TIME_LIMIT_SECONDS = 60;

    
    function parseNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return parseFloat(value.replace(',', '.')) || 0;
    return 0;
    }

function safeJsonParse(jsonString, defaultValue = []) {
    if (!jsonString || typeof jsonString !== 'string') return defaultValue;

    try {
        // Attempt to fix common JSON errors from manual entry
        const cleanedString = jsonString
            // Remove trailing commas from arrays: [ "a", "b", ] -> [ "a", "b" ]
            .replace(/,\s*\]/g, ']')
            // Remove trailing commas from objects: { "a": 1, } -> { "a": 1 }
            .replace(/,\s*\}/g, '}');

        return JSON.parse(cleanedString);
    } catch (e) {
        // ✅ Enhanced logging for easier debugging of Excel data
        console.error(`[DATA_ERROR] Failed to parse JSON string. Check for syntax errors (e.g., missing brackets, trailing commas). Problematic string:`, jsonString);
        return defaultValue;
    }
}

    function calculatePO2fromSaturation(saturation) {
    if (saturation <= 92) {
        // Om mättnaden är 92% eller lägre, är PO₂ 8 kPa eller lägre.
        // För enkelhetens skull returnerar vi ett värde strax under tröskeln.
        return 7.9;
    }
    // Enkel linjär approximation för värden över 92%.
    // Exempel: 92% -> 8 kPa, 100% -> ca 13 kPa.
    const po2 = 8 + (saturation - 92) * 0.625;
    return po2;
}

function updatePatientStates() {
    // --- Simuleringskonstanter ---
    // KOL & Syre
    const HYPEROXIA_PO2_THRESHOLD_COPD = 8.0; // ÄNDRAD: Ny tröskel baserad på PO₂ (kPa)
    const RESPIRATORY_DEPRESSION_RATE = 2;
    const MIN_RESPIRATORY_RATE = 8;
    // pCO2 & RLS
    const NORMAL_PCO2_KPA = 5.5;
    const PCO2_CHANGE_PER_TICK = 1;
    const RLS2_PCO2_THRESHOLD = 8.0;
    const RLS3_PCO2_THRESHOLD = 10.0;
    const NORMAL_AF_MIN = 12;
    const NORMAL_AF_MAX = 20;

    for (const patientId in activePatients) {
        try {
            const patient = activePatients[patientId];
            if (patient.isFailed) continue;

            const vitals = patient.currentVitals;

            // --- Initialize pCO₂ if it doesn't exist ---
            if (patient.pCO2 === undefined) {
                patient.pCO2 = NORMAL_PCO2_KPA;
            }

            // --- CONTINUOUS THERAPY & EFFECTS ---
            // (Oxygen and Medication effects that might alter vitals)
            if (patient.activeTherapies?.oxygen) {
            // Find the oxygen configuration in the main medications list
            const oxygenInfo = allMedications.find(m => m.id === 'oxygen');
            
            if (oxygenInfo && oxygenInfo.therapy_type === 'continuous_flow') {
            const flowRate = patient.activeTherapies.oxygen.flowRate;
            const therapyParams = oxygenInfo.therapy_params;
            const baseIncrease = therapyParams.saturation_increase_per_L;

            // Calculate the per-tick increase in saturation
            const potentialIncrease = (baseIncrease * flowRate) / 20; // Divided by 20 to apply effect gradually over ~100s

            // Apply the effect, but don't let saturation exceed 100
            vitals.Saturation = Math.min(100, vitals.Saturation + potentialIncrease);
            }
            }       

            // --- Medication Effects Logic ---
        if (patient.activeEffects && patient.activeEffects.length > 0) {
            patient.activeEffects.forEach(effect => {
            if (effect.remaining > 0) {
                let targetKey = effect.target;
                let newValue;

                if (vitals[targetKey] !== undefined) {
                vitals[targetKey] += (effect.change / effect.duration);
                } else if (patient[targetKey] !== undefined) {
                let currentValue = parseFloat(patient[targetKey]);
                if (!isNaN(currentValue)) {
                    let changePerTick = (effect.change / effect.duration);

                    if (targetKey === 'P-Glukos' && changePerTick < 0) {
                    const GLUCOSE_DIMINISHING_THRESHOLD = 4.0;
                    if (currentValue < GLUCOSE_DIMINISHING_THRESHOLD && currentValue > 0) {
                        const effectScale = currentValue / GLUCOSE_DIMINISHING_THRESHOLD;
                        changePerTick *= effectScale;
                    }
                    }
                    currentValue += changePerTick;

                    if (targetKey === 'P-Glukos' && currentValue < 0) {
                    currentValue = 0;
                    }
                    
                    newValue = currentValue.toFixed(1);
                    patient[targetKey] = newValue;

                    const testInfo = allLabTests.find(t => t.name === targetKey);
                    if (testInfo && patient.orderedLabs && patient.orderedLabs[testInfo.id]) {
                    patient.orderedLabs[testInfo.id].result = `${newValue} ${testInfo.normalRange_unit || ''}`.trim();
                    }
                }
                }
                effect.remaining--;
            }
            });
            patient.activeEffects = patient.activeEffects.filter(e => e.remaining > 0);
        }

            if (patient.pCO2 === undefined) {
                patient.pCO2 = NORMAL_PCO2_KPA;
            }
        
            patient.PO2 = calculatePO2fromSaturation(vitals.Saturation);
            if (patient.KOL && patient.PO2 > HYPEROXIA_PO2_THRESHOLD_COPD) {
                console.log(`[SIMULATION] Patient ${patient.name} har KOL och hyperoxi (PO₂ > 8). Inducerar andningsdepression.`);
                vitals.AF = Math.max(MIN_RESPIRATORY_RATE, vitals.AF - RESPIRATORY_DEPRESSION_RATE);
            }

            let pco2_change = 0;
            if (vitals.AF < NORMAL_AF_MIN) {
                console.log(`[LOG] AF is low for ${patient.name}. Increasing pCO₂.`);
                pco2_change = PCO2_CHANGE_PER_TICK;
            } else if (vitals.AF > NORMAL_AF_MAX) {
                pco2_change = -PCO2_CHANGE_PER_TICK;
            } else {
                if (patient.pCO2 > NORMAL_PCO2_KPA) {
                    pco2_change = -PCO2_CHANGE_PER_TICK / 2; 
                } else if (patient.pCO2 < NORMAL_PCO2_KPA) {
                    pco2_change = PCO2_CHANGE_PER_TICK / 2;
                }
            }
            patient.pCO2 = Math.max(2.0, patient.pCO2 + pco2_change);

        // --- UPDATED: RLS Calculation ---
        const baseRls = parseNumber(patient.RLS);
        let glucoseRls = baseRls;
        let co2Rls = baseRls;

        // 1. Check for hypoglycemia effect on RLS (Existing Logic)
        if (patient['P-Glukos']) {
            const glucoseValue = parseFloat(patient['P-Glukos']);
            if (!isNaN(glucoseValue)) {
                if (glucoseValue < 2.0) glucoseRls = 3;
                else if (glucoseValue < 3.0) glucoseRls = 2;
            }
        }

        // 2. NEW: Check for hypercapnia effect on RLS (CO₂ Narcosis)
            if (patient.pCO2 > RLS3_PCO2_THRESHOLD) {
                co2Rls = 3; // Severe CO₂ retention causes unconsciousness
            } else if (patient.pCO2 > RLS2_PCO2_THRESHOLD) {
                co2Rls = 2; // Moderate CO₂ retention causes drowsiness
            }

            // 3. Final RLS is determined by the most severe condition
            patient.currentVitals.RLS = Math.max(baseRls, glucoseRls, co2Rls);

        if (patient['P-Glukos']) {
            const glucoseValue = parseFloat(patient['P-Glukos']);
            const GLUCOSE_COUNTER_THRESHOLD = 3.5;

            if (!isNaN(glucoseValue) && glucoseValue < GLUCOSE_COUNTER_THRESHOLD) {
            const hasCounterEffect = patient.activeEffects.some(e => e.isCounterRegulatory);
            
            if (!hasCounterEffect) {
                console.log(`[SIMULATION] Patient ${patient.name} is hypoglycemic. Initiating counter-regulatory response.`);
                patient.activeEffects.push({
                target: 'P-Glukos',
                change: 2.0,
                duration: 12,
                remaining: 12,
                isCounterRegulatory: true
                });
            }
            }
        }

        // --- Failure Check Logic ---
        let isCurrentlyCritical = false;

        if (vitals.BT_systolic < criticalThresholds.BT_systolic.lower) isCurrentlyCritical = true;
        if (vitals.Saturation < criticalThresholds.Saturation.lower) isCurrentlyCritical = true;
        if (vitals.Puls < criticalThresholds.Puls.lower || vitals.Puls > criticalThresholds.Puls.upper) isCurrentlyCritical = true;
        if (vitals.AF < MIN_RESPIRATORY_RATE + 2) isCurrentlyCritical = true;
        
        if (patient['P-Glukos']) {
            const glucoseValue = parseFloat(patient['P-Glukos']);
            if (!isNaN(glucoseValue) && glucoseValue < criticalThresholds['P-Glukos'].lower) {
            isCurrentlyCritical = true;
            }
        }
        
        if (isCurrentlyCritical) {
            patient.isCritical = true;
            patient.timeInCriticalState += 5;
        } else {
            patient.isCritical = false;
            patient.timeInCriticalState = 0;
        }

        if (patient.timeInCriticalState >= CRITICAL_TIME_LIMIT_SECONDS) {
            patient.isFailed = true;
            console.log(`[GAME OVER] Patient ${patient.name} (ID: ${patientId}) has been lost.`);
        }
        
        patient.triageLevel = calculateAgeTriageLevel(patient.currentVitals, patient.age);

        } catch (error) {
        console.error(`❌ Error updating state for patient ID ${patientId}:`, error);
        }
    }
    }

    function getRandomInRange(min, max, decimals) {
    const numMin = parseFloat(min);
    const numMax = parseFloat(max);
    const numDecimals = parseInt(decimals, 10) || 0;

    if (isNaN(numMin) || isNaN(numMax)) {
        return 'N/A';
    }

    const value = Math.random() * (numMax - numMin) + numMin;
    return value.toFixed(numDecimals);
    }

    function getActionNameById(action) {
    // If the "action" is an array of choices, format it nicely
    if (Array.isArray(action)) {
        return action.map(id => getActionNameById(id)).join(' or ');
    }
    
    // If it's a single ID string, use the existing lookup logic
    const lowerCaseId = (action || '').toLowerCase();

    const labTest = allLabTests.find(t => t && t.id && t.id.toLowerCase() === lowerCaseId);
    if (labTest) return labTest.name;

    const med = allMedications.find(m => m && m.id && m.id.toLowerCase() === lowerCaseId);
    if (med) return med.name;
    
    const bedsideTest = allBedsideTests.find(t => t && t.id && t.id.toLowerCase() === lowerCaseId);
    if (bedsideTest) return bedsideTest.name;
    
    const radiologyTest = allRadiologyTests.find(r => r && r.id && r.id.toLowerCase() === lowerCaseId);
    if (radiologyTest) return radiologyTest.name;
    
    const physicalExam = allPhysicalExams.find(e => e && e.id && e.id.toLowerCase() === lowerCaseId);
    if (physicalExam) return physicalExam.name;

    return action; // Fallback
    }   

    function getActionCategory(id) {
        // ✅ FIX: Handle cases where the 'id' is an array (for OR conditions).
        // If it's an array, we determine the category based on its first element,
        // as all choices in the group should belong to the same category.
        if (Array.isArray(id)) {
            return id.length > 0 ? getActionCategory(id[0]) : 'unknown';
        }

        const lowerCaseId = (id || '').toLowerCase(); 

        // This specific order is crucial to prevent misclassification.
        // It checks the most unique categories first.
        if (allLabTests.some(item => item && item.id && item.id.toLowerCase() === lowerCaseId)) return 'lab';
        if (allBedsideTests.some(item => item && item.id && item.id.toLowerCase() === lowerCaseId)) return 'bedside';
        if (allRadiologyTests.some(item => item && item.id && item.id.toLowerCase() === lowerCaseId)) return 'radiology';
        if (allMedications.some(item => item && item.id && item.id.toLowerCase() === lowerCaseId)) return 'med';
        
        // Check for physical exams last, using the 'name' column.
        if (allPhysicalExams.some(item => item && item.name && item.name.toLowerCase() === lowerCaseId)) return 'exam';
        
        return 'unknown';
    }

    // Start the simulation loop using a helper function
    setInterval(() => updatePatientStates(), 5000);

    router.get('/game-data', (req, res) => {
    const visibleLabTests = allLabTests.filter(test => !test.isHidden);

        res.json({
            labTests: visibleLabTests,
            labKits: gameData.allLabKits,
            bedsideTests: allBedsideTests,
            medications: allMedications,
            radiologyTests: allRadiologyTests,
            standardFindings: standardFindings,
            physicalExams: allPhysicalExams,
            allDiagnoses: gameData.allDiagnoses,
            allPrescriptions: gameData.allPrescriptions // ✅ Add prescriptions to the response
        });
    });

    router.post("/chat", async (req, res) => {
        try {
            const { message, patientId } = req.body;
            const patient = activePatients[patientId];
    
            if (!patient) {
                return res.status(404).json({ error: "Patient not found or not active." });
            }
            
            if (!patient.chatHistory) patient.chatHistory = [];
            if (!patient.activeEffects) patient.activeEffects = [];
            
            patient.chatHistory.push({ role: "user", content: message });
    
            let systemPrompt;
            let speakerName;
    
            // --- PEDIATRIC & ADULT LOGIC ---
            if (patient.ParentPrompt) { // Check if it's a pediatric case
                // --- 1. AI ROUTER STEP ---
                const parentName = patient.ParentName || 'föräldern';
                const routerPrompt = `Du är en expert på att avgöra vem en fråga är ställd till i ett medicinskt sammanhang. En läkare befinner sig på en akutmottagning med ett litet barn som heter ${patient.name} och barnets förälder, ${parentName}. Föräldern är den primära källan för sjukdomshistoria och information. Barnet svarar bara på mycket enkla frågor som ställs direkt till hen.
    
                Här är några exempel:
                - Läkaren säger: "Har hon haft feber?" Ditt svar: parent
                - Läkaren säger: "${patient.name}, kan du visa mig var det gör ont i magen?" Ditt svar: child
                - Läkaren säger: "Hur mår hon i övrigt?" Ditt svar: parent
                - Läkaren säger: "Hur mår ${patient.name} i övrigt?" Ditt svar: parent
                - Läkaren säger: "Några allergier?" Ditt svar: parent
    
                Analysera nu detta uttalande från läkaren: "${message}"
    
                Vem är frågan ställd till? Hela ditt svar måste vara ett enda ord: antingen 'child' eller 'parent'.
                `;
                const routerResponse = await gameData.openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: routerPrompt }],
                });
                
                let targetSpeaker = (routerResponse.choices[0].message?.content || 'parent').toLowerCase().trim();
                
                // Safety check in case the AI responds with something unexpected
                if (targetSpeaker !== 'child' && targetSpeaker !== 'parent') {
                    targetSpeaker = 'parent'; 
                }
    
                console.log(`[AI Router] Determined target: ${targetSpeaker}`);
    
                // --- 2. CHARACTER RESPONSE STEP ---
                if (targetSpeaker === 'child' && patient.age > 2) {
                    systemPrompt = patient.ChildPrompt;
                    speakerName = patient.name;
                } else {
                    systemPrompt = patient.ParentPrompt;
                    speakerName = patient.ParentName || "Parent"; 
                }
                patient.currentSpeaker = targetSpeaker;
                
            } else {
                // --- Original Logic for Adult Patients ---
                systemPrompt = patient.Prompt;
                speakerName = patient.name;
            }
    
            console.log(`[CHAT] Final Speaker: ${speakerName}`);
    
            // Build the dynamic state based on vitals and effects
            let dynamicState = "AKTUELLT TILLSTÅND: ";
            if (patient.activeEffects.some(e => e.target !== 'ai')) {
            dynamicState += "Du har nyligen fått medicin. ";
            }
            if (patient.currentVitals.BT_systolic < 90) {
            dynamicState += "Du känner dig yr och svag. ";
            }
            if (patient.currentVitals.AF > 28) {
            dynamicState += "Du känner dig andfådd. ";
            }
            patient.activeEffects.forEach(effect => {
            if (effect.target === 'ai' && effect.remaining > 0) {
                dynamicState += effect.description + " ";
            }
            });
    
            const newInstructions = "Du är en patient på en akutmottagning. Svara alltid som din karaktär. Dina svar måste vara extremt korta, helst bara en enda mening. Svara BARA på den direkta frågan som ställs. Erbjud absolut ingen extra information som inte efterfrågas. Om du inte vet svaret, säg 'Jag vet inte'.";
            const finalSystemPrompt = `${systemPrompt}\n\n${dynamicState}\n\n[VIKTIGA INSTRUKTIONER]:\n${newInstructions}`;
    
            const messagesForApi = [
                { role: "system", content: finalSystemPrompt },
                ...patient.chatHistory
            ];
            
            const response = await gameData.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messagesForApi,
            });
    
            const aiReply = response.choices[0].message?.content ?? "No content returned";
    
            patient.chatHistory.push({ role: "assistant", content: aiReply });
            
            res.json({ reply: aiReply, speaker: speakerName });
    
        } catch (err) {
            console.error("Error in /chat endpoint:", err);
            res.status(500).json({ error: "Something went wrong in the chat." });
        }
        });

    router.post('/evaluate-case', async (req, res) => {
    try {
        // --- DATA GATHERING ---
        const { actionsTaken, playerDiagnosis, playerChoice, caseId, playerPrescriptions, playerAdmissionPlan } = req.body;
        const patientSolution = allPatients.find(p => p.originalIndex == caseId);
        const patientSession = activePatients[caseId];
        const chatHistory = patientSession ? patientSession.chatHistory : [];
        const isDiagnosisCorrect = !!playerDiagnosis && (playerDiagnosis.toLowerCase().trim() === (patientSolution.Diagnosis || '').toLowerCase().trim());

        if (!patientSolution) {
        return res.status(404).json({ error: 'Patient case not found.' });
        }

        let playerScore = 0;
        let maxScore = 0;
        let utredningHTML = '';
        let åtgärderHTML = '';

        // --- 2. ANAMNESIS AND DIAGNOSIS ("Utredning") ---
        const anamnesisChecklist = safeJsonParse(patientSolution.AnamnesisChecklist, []);
        if (anamnesisChecklist.length > 0) {
            maxScore += anamnesisChecklist.length * 5;
            const playerChat = chatHistory.filter(msg => msg.role === 'user').map(msg => msg.content.toLowerCase()).join(' ');
            
            utredningHTML += '<h5>Anamnesis Checklist</h5><div class="feedback-items-grid">';
            anamnesisChecklist.forEach(item => {
                const foundKeyword = item.keywords.some(kw => playerChat.includes(kw.toLowerCase()));
                if (foundKeyword) playerScore += 5;
                const icon = foundKeyword ? '✓' : '✗';
                const cssClass = foundKeyword ? 'correct' : 'missed';
                utredningHTML += `<div class="feedback-task ${cssClass}"><span class="task-icon">${icon}</span><span class="task-name">${item.question}</span></div>`;
            });
            utredningHTML += '</div>';
        }

        // --- 3. ACTIONS (with nested OR conditions) ---
        const points = { critical: 10, recommended: 5, contraindicated: -25 };
        const playerActions = new Set(actionsTaken.map(id => id.toLowerCase()));

        // Get the raw action lists, without flattening them yet
        const rawCritical = safeJsonParse(patientSolution.ActionsCritical, []);
        const rawRecommended = safeJsonParse(patientSolution.ActionsRecommended, []);
        const contraindicated = safeJsonParse(patientSolution.ActionsContraindicated, []).flat().map(id => id.toLowerCase());

        let criticalPerformed = [];
        let criticalMissed = [];
        let recommendedPerformed = [];
        let recommendedMissed = [];


        // --- Process Critical Actions ---
        maxScore += rawCritical.length * points.critical;
        rawCritical.forEach(action => {
            if (typeof action === 'string') {
                // It's a single required action
                const actionId = action.toLowerCase();
                if (playerActions.has(actionId)) {
                    playerScore += points.critical;
                    criticalPerformed.push(actionId);
                } else {
                    criticalMissed.push(actionId);
                }
            } else if (Array.isArray(action)) {
                // It's a choice between multiple actions (an OR condition)
                const choiceIds = action.map(id => id.toLowerCase());
                const performedChoice = choiceIds.find(id => playerActions.has(id));

                if (performedChoice) {
                    playerScore += points.critical;
                    // For the report, show the action they actually performed
                    criticalPerformed.push(performedChoice);
                } else {
                    // If none were performed, create a special string for the report
                    criticalMissed.push(action); // Keep it as an array for the helper
                }
            }
        });

        // --- Process Recommended Actions (same logic) ---
        maxScore += rawRecommended.length * points.recommended;
        rawRecommended.forEach(action => {
            if (typeof action === 'string') {
                const actionId = action.toLowerCase();
                if (playerActions.has(actionId)) {
                    playerScore += points.recommended;
                    recommendedPerformed.push(actionId);
                } else {
                    recommendedMissed.push(actionId);
                }
            } else if (Array.isArray(action)) {
                const choiceIds = action.map(id => id.toLowerCase());
                const performedChoice = choiceIds.find(id => playerActions.has(id));
                if (performedChoice) {
                    playerScore += points.recommended;
                    recommendedPerformed.push(performedChoice);
                } else {
                    recommendedMissed.push(action);
                }
            }
        });

        // Process contraindicated actions (this part is simpler)
        contraindicated.forEach(id => { if (playerActions.has(id)) playerScore += points.contraindicated; });

        const reportData = {
            critical: { performed: criticalPerformed, missed: criticalMissed },
            recommended: { performed: recommendedPerformed, missed: recommendedMissed },
            contraindicated: { performed: contraindicated.filter(id => playerActions.has(id)) }
        };


        // --- TROUBLESHOOTING LOG 1 ---
        // Let's see what actions the server thinks were performed or missed.
        console.log("--- Initial Report Data ---");
        console.log("Critical Performed:", reportData.critical.performed);
        console.log("Critical Missed:", reportData.critical.missed);
        console.log("--------------------------");


        // Helper function to generate HTML for a list of actions
        const generateActionHTML = (actions, isMissed) => {
            let html = '';
            const icon = isMissed ? '✗' : '✓';
            const cssClass = isMissed ? 'missed' : 'correct';
            actions.forEach(id => {
                const actionName = getActionNameById(id);
                
                // --- FINAL DEBUG LOG ---
                console.log(`  -> Building HTML for ID: '${id}', Found Name: '${actionName}'`);

                html += `<div class="feedback-task ${cssClass}"><span class="task-icon">${icon}</span><span class="task-name">${actionName}</span></div>`;
            });
            return html;
        };

        const utredningCategories = {
            exam: 'Physical Exams',
            lab: 'Lab Tests',
            bedside: 'Bedside Tests',
            radiology: 'Radiology'
        };
        const åtgärderCategories = {
            med: 'Medications'
        };

        // ** BUILD UTREDNING HTML **
        Object.entries(utredningCategories).forEach(([categoryKey, categoryTitle]) => {
            const critPerformed = reportData.critical.performed.filter(id => getActionCategory(id) === categoryKey);
            const critMissed = reportData.critical.missed.filter(id => getActionCategory(id) === categoryKey);
            const recPerformed = reportData.recommended.performed.filter(id => getActionCategory(id) === categoryKey);
            const recMissed = reportData.recommended.missed.filter(id => getActionCategory(id) === categoryKey);
            
            // --- TROUBLESHOOTING LOG 2 ---
            // Let's see if the filters are finding any matches for each category.
            console.log(`\nProcessing Category: ${categoryTitle}`);
            console.log(`Found ${critPerformed.length} critical performed actions.`);
            console.log(`Found ${critMissed.length} critical missed actions.`);

            if (critPerformed.length > 0 || critMissed.length > 0 || recPerformed.length > 0 || recMissed.length > 0) {
                utredningHTML += `<hr><h5>${categoryTitle}</h5>`;
                
                const hasCriticalActions = critPerformed.length > 0 || critMissed.length > 0;
                
                utredningHTML += `<div class="importance-columns">`;

                // --- Left Column ---
                utredningHTML += `<div class="column">`;
                if (hasCriticalActions) {
                    // If critical actions exist, they go on the left.
                    utredningHTML += `<h6 class="feedback-category-title">Critical</h6><div class="feedback-items-grid">`;
                    utredningHTML += generateActionHTML(critPerformed, false);
                    utredningHTML += generateActionHTML(critMissed, true);
                    utredningHTML += `</div>`;
                } else {
                    // If NO critical actions, Recommended actions go on the left.
                    utredningHTML += `<h6 class="feedback-category-title">Recommended</h6><div class="feedback-items-grid">`;
                    utredningHTML += generateActionHTML(recPerformed, false);
                    utredningHTML += generateActionHTML(recMissed, true);
                    utredningHTML += `</div>`;
                }
                utredningHTML += `</div>`; // End left column

                // --- Right Column ---
                utredningHTML += `<div class="column">`;
                if (hasCriticalActions && (recPerformed.length > 0 || recMissed.length > 0)) {
                    // Only add Recommended actions here IF there were also Critical actions.
                    utredningHTML += `<h6 class="feedback-category-title">Recommended</h6><div class="feedback-items-grid">`;
                    utredningHTML += generateActionHTML(recPerformed, false);
                    utredningHTML += generateActionHTML(recMissed, true);
                    utredningHTML += `</div>`;
                }
                utredningHTML += `</div>`; // End right column

                utredningHTML += `</div>`; // End importance-columns
            }
        });

        // ** BUILD ÅTGÄRDER HTML **
        Object.entries(åtgärderCategories).forEach(([categoryKey, categoryTitle]) => {
            const critPerformed = reportData.critical.performed.filter(id => getActionCategory(id) === categoryKey);
            const critMissed = reportData.critical.missed.filter(id => getActionCategory(id) === categoryKey);
            const recPerformed = reportData.recommended.performed.filter(id => getActionCategory(id) === categoryKey);
            const recMissed = reportData.recommended.missed.filter(id => getActionCategory(id) === categoryKey);

            if (critPerformed.length > 0 || critMissed.length > 0 || recPerformed.length > 0 || recMissed.length > 0) {
                åtgärderHTML += `<hr><h5>${categoryTitle}</h5>`;
                
                const hasCriticalActions = critPerformed.length > 0 || critMissed.length > 0;
                
                åtgärderHTML += `<div class="importance-columns">`;

                // --- Left Column ---
                åtgärderHTML += `<div class="column">`;
                if (hasCriticalActions) {
                    åtgärderHTML += `<h6 class="feedback-category-title">Critical</h6><div class="feedback-items-grid">`;
                    åtgärderHTML += generateActionHTML(critPerformed, false);
                    åtgärderHTML += generateActionHTML(critMissed, true);
                    åtgärderHTML += `</div>`;
                } else {
                    åtgärderHTML += `<h6 class="feedback-category-title">Recommended</h6><div class="feedback-items-grid">`;
                    åtgärderHTML += generateActionHTML(recPerformed, false);
                    åtgärderHTML += generateActionHTML(recMissed, true);
                    åtgärderHTML += `</div>`;
                }
                åtgärderHTML += `</div>`; // End left column

                // --- Right Column ---
                åtgärderHTML += `<div class="column">`;
                if (hasCriticalActions && (recPerformed.length > 0 || recMissed.length > 0)) {
                    åtgärderHTML += `<h6 class="feedback-category-title">Recommended</h6><div class="feedback-items-grid">`;
                    åtgärderHTML += generateActionHTML(recPerformed, false);
                    åtgärderHTML += generateActionHTML(recMissed, true);
                    åtgärderHTML += `</div>`;
                }
                åtgärderHTML += `</div>`; // End right column

                åtgärderHTML += `</div>`; // End importance-columns
            }
        });

        // Add Contraindicated actions
        if (reportData.contraindicated.performed.length > 0) {
            åtgärderHTML += '<hr><h5>Contraindicated Actions Performed</h5><div class="feedback-items-grid">';
            reportData.contraindicated.performed.forEach(id => {
                åtgärderHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${getActionNameById(id)}</span></div>`;
            });
            åtgärderHTML += `</div>`;
        }
        
        // --- PRESCRIPTION EVALUATION ---
        if (playerChoice === 'Home' && playerPrescriptions) {
            const solutionPrescriptions = new Set(safeJsonParse(patientSolution.PrescriptionsSolution, []));
            const playerPrescriptionSet = new Set(playerPrescriptions);
            const prescriptionPoints = 2; // Points per correct prescription

            if (solutionPrescriptions.size > 0 || playerPrescriptionSet.size > 0) {
                åtgärderHTML += '<hr><h5>Prescriptions</h5><div class="feedback-items-grid">';
                maxScore += solutionPrescriptions.size * prescriptionPoints;

                const allConsidered = new Set([...solutionPrescriptions, ...playerPrescriptionSet]);

                allConsidered.forEach(id => {
                    const isCorrect = solutionPrescriptions.has(id);
                    const wasChosen = playerPrescriptionSet.has(id);
                    const name = getActionNameById(id);

                    if (isCorrect && wasChosen) { playerScore += prescriptionPoints; åtgärderHTML += `<div class="feedback-task correct"><span class="task-icon">✓</span><span class="task-name">${name}</span></div>`; }
                    else if (isCorrect && !wasChosen) { åtgärderHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${name} (Missed)</span></div>`; }
                    else if (!isCorrect && wasChosen) { playerScore -= prescriptionPoints; åtgärderHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${name} (Unnecessary)</span></div>`; }
                });
                åtgärderHTML += '</div>';
            }
        }

        // --- 1. ADMISSION PLAN EVALUATION (with checkboxes) ---
        if (playerChoice === 'Ward' && playerAdmissionPlan) {
            const planSolution = safeJsonParse(patientSolution.AdmissionPlanSolution, {});
            const planPoints = 5;

            const orderedItems = [];
            const missedItems = [];

            // --- Evaluate Medications ---
            if (planSolution.medications) {
                maxScore += planSolution.medications.length * planPoints;
                planSolution.medications.forEach(solutionMed => {
                    const medInfo = allMedications.find(m => m.id === solutionMed.id);
                    if (!medInfo) return;

                    const playerOrder = playerAdmissionPlan.medications.find(pMed => pMed.id === solutionMed.id);
                    let isCorrect = false;
                    let feedbackText = `${medInfo.name}`;

                    if (playerOrder) {
                        const playerDose = parseFloat(playerOrder.dose);
                        const playerFrequencyValue = parseInt(playerOrder.frequency);
                        const hasReasonableRange = medInfo.reasonable_dose_min != null && medInfo.reasonable_dose_max != null && medInfo.reasonable_dose_min !== '';

                        if (hasReasonableRange) {
                            if (!isNaN(playerFrequencyValue) && playerFrequencyValue > 0) {
                                const totalDailyDose = playerDose * playerFrequencyValue;
                                const minDose = parseFloat(medInfo.reasonable_dose_min);
                                const maxDose = parseFloat(medInfo.reasonable_dose_max);
                                isCorrect = totalDailyDose >= minDose && totalDailyDose <= maxDose;
                            }
                        } else {
                            const solutionDose = parseFloat(solutionMed.dose);
                            const frequencyIsCorrect = playerOrder.frequency == solutionMed.frequency;
                            const doseIsCorrect = Math.abs(playerDose - solutionDose) < 0.01;
                            isCorrect = doseIsCorrect && frequencyIsCorrect;
                        }
                        feedbackText = `${medInfo.name} ${playerOrder.dose}${medInfo.doseUnit || ''} x ${playerOrder.frequency}`;
                    }

                    if (isCorrect) {
                        playerScore += planPoints;
                        orderedItems.push(feedbackText);
                    } else {
                        missedItems.push(feedbackText);
                    }
                });
            }

            // --- Evaluate Monitoring ---
            if (planSolution.monitoring) {
                const playerMon = playerAdmissionPlan.monitoring;
                const solutionMon = planSolution.monitoring;

                const addMonitoringFeedback = (label, playerValue, solutionValue) => {
                    if (solutionValue === undefined) return;

                    maxScore += planPoints;
                    let isCorrect = Array.isArray(solutionValue) ? solutionValue.includes(playerValue) : playerValue === solutionValue;

                    if (isCorrect) {
                        playerScore += planPoints;
                        if (solutionValue) { // Only show correctly ordered items, not correctly omitted ones
                            const feedbackText = (label === 'Vitals') ? `NEWS (${playerValue === 'none' ? 'Never' : `Varje ${playerValue}`})` : label;
                            orderedItems.push(feedbackText);
                        }
                    } else {
                        const feedbackText = (label === 'Vitals') ? `NEWS` : label;
                        if (solutionValue) { // Missed a required action
                            missedItems.push(feedbackText);
                        } else { // Performed an unnecessary action
                            orderedItems.push({ text: feedbackText, isUnnecessary: true });
                        }
                    }
                };

                addMonitoringFeedback('Vitals', playerMon.vitals_frequency, solutionMon.vitals_frequency);
                addMonitoringFeedback('Fasta', playerMon.fasta, solutionMon.fasta);
                addMonitoringFeedback('Vätske- & urinmätning', playerMon.urine_output, solutionMon.urine_output);
                addMonitoringFeedback('Daglig vikt', playerMon.daily_weight, solutionMon.daily_weight);
                addMonitoringFeedback('Glukoskurva', playerMon.glucose_curve, solutionMon.glucose_curve);
                addMonitoringFeedback('Operationsanmälan', playerMon.surgery_notification, solutionMon.surgery_notification);
            }

            // --- Build the HTML ---
            if (orderedItems.length > 0 || missedItems.length > 0) {
                åtgärderHTML += '<hr><h5>Admission Plan</h5>';
                åtgärderHTML += '<div class="importance-columns">';
                
                // Ordered Column
                åtgärderHTML += '<div class="column"><h6 class="feedback-category-title">Ordered</h6><div class="feedback-items-grid">';
                orderedItems.forEach(item => {
                    if (typeof item === 'object' && item.isUnnecessary) {
                        // Render unnecessary items in red within the "Ordered" column
                        åtgärderHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${item.text} (Unnecessary)</span></div>`;
                    } else {
                        åtgärderHTML += `<div class="feedback-task correct"><span class="task-icon">✓</span><span class="task-name">${item}</span></div>`;
                    }
                });
                åtgärderHTML += '</div></div>';

                // Missed Column
                åtgärderHTML += '<div class="column"><h6 class="feedback-category-title">Missed</h6><div class="feedback-items-grid">';
                missedItems.forEach(text => {
                    åtgärderHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${text}</span></div>`;
                });
                åtgärderHTML += '</div></div>';

                åtgärderHTML += '</div>';
            }
        }

        // --- 4. CALCULATE SCORE & RESPOND ---
        if (maxScore <= 0) maxScore = 100;
        let finalScore = Math.round(Math.max(0, Math.min(100, (playerScore / maxScore) * 100)));

        if (req.isAuthenticated()) {
            // Check if the user has rated this case before
            const hasBeenRatedBefore = await checkIfCaseRated(req.user.id, caseId);

            // Attach this info to the response
            res.locals.hasBeenRatedBefore = hasBeenRatedBefore;

            console.log('User is logged in. Saving game result...');
            const resultData = {
                caseId,
                playerId: req.user.id, // req.user is guaranteed to exist here
                score: finalScore, // The score to save
                actionsTaken: actionsTaken // The array of action IDs to save
            };
            await saveGameResult(resultData);
        } else {
            console.log('User is a guest. Not saving game result.');
        }
        // 👇 ADD THIS FINAL TROUBLESHOOTING LOG
        console.log("\n--- FINAL HTML CONTENT ---");
        console.log("Utredning HTML length:", utredningHTML.length);
        console.log("Åtgärder HTML length:", åtgärderHTML.length);
        console.log("--------------------------\n");


        res.json({ 
            finalScore, 
            utredningHTML,
            åtgärderHTML,
            correctDiagnosis: patientSolution.Diagnosis,
            patientAvatar: `${req.protocol}://${req.get('host')}/images/${patientSolution.patient_avatar}`,
            isDiagnosisCorrect,
            fallbeskrivning: patientSolution.Fallbeskrivning,
            hasBeenRatedBefore: res.locals.hasBeenRatedBefore || false
        });

        

    } catch (err) {
        console.error("Error during case evaluation:", err);
        res.status(500).json({ error: 'Server error during evaluation.' });
    }
    });

    router.post('/rate-case', async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ message: 'User not authenticated.' });
        }

        const { caseId, rating, feedback } = req.body;
        const playerId = req.user.id;

        if (!caseId || !rating || rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Invalid case ID or rating provided.' });
        }

        try {
            // Find the most recent result for this player and case, and update it
            await helpers.rateGameResult(playerId, caseId, rating, feedback);
            res.json({ message: 'Rating saved successfully.' });
        } catch (error) {
            console.error("Error saving case rating:", error);
            res.status(500).json({ message: 'Server error while saving rating.' });
        }
    });

    router.post('/reset', (req, res) => {
        // ✅ Access the array using gameData.availablePatients
        gameData.availablePatients.length = 0;

        const newShuffledPatients = shuffle([...allPatients]);
        Array.prototype.push.apply(gameData.availablePatients, newShuffledPatients);

        Object.keys(activePatients).forEach(key => delete activePatients[key]);
        
        console.log(`Game reset. ${gameData.availablePatients.length} patients are now available.`);
        res.json({ message: 'Game reset.' });
    });

    router.get("/random-patient", (req, res) => {
    if (!gameData.availablePatients || gameData.availablePatients.length === 0) {
        return res.status(404).json({ message: "No more patients available" });
    }
    // Create a deep copy of the patient object to avoid modifying the original data in 'allPatients'
    const originalPatientData = gameData.availablePatients.pop();
    const patientToSend = JSON.parse(JSON.stringify(originalPatientData));

    allLabTests.forEach(test => {
        const patientValue = patientToSend[test.id];
        let finalValue;
        if (patientValue !== undefined && patientValue !== null && patientValue !== '') {
        finalValue = `${patientValue}`;
        } else {
        const normalValue = getRandomInRange(
            test.normalRange_min,
            test.normalRange_max,
            test.normalRange_decimals
        );
        finalValue = `${normalValue}`;
        }
        patientToSend[test.name] = finalValue;
    });
    
    const initialVitals = {
        AF: parseNumber(patientToSend.AF),
        Saturation: parseNumber(patientToSend.Saturation),
        Puls: parseNumber(patientToSend.Puls),
        BT_systolic: parseNumber(patientToSend.BT_systolic),
        BT_diastolic: parseNumber(patientToSend.BT_diastolic),
        Temp: parseNumber(patientToSend.Temp),
        RLS: parseNumber(patientToSend.RLS)
    };
    patientToSend.triageLevel = calculateAgeTriageLevel(initialVitals, patientToSend.age);

    activePatients[patientToSend.originalIndex] = {
        ...patientToSend,
        isFailed: false,
        isCritical: false,
        timeInCriticalState: 0,
        activeEffects: [],
        chatHistory: [],
        orderedLabs: {},
        currentVitals: initialVitals
    };
    res.json({ id: patientToSend.originalIndex, ...patientToSend });
    });

    return router;
}
