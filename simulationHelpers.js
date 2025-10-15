const pediatricVitalsByAge = [
    // Age is in years. For infants, we use fractions (e.g., 1 month = 1/12 years).
    { ageMax: 1/12, AF: { min: 30, max: 60 }, Puls: { min: 100, max: 180 }, BT_systolic: { min: 60 } }, // Newborn
    { ageMax: 1,    AF: { min: 25, max: 50 }, Puls: { min: 100, max: 160 }, BT_systolic: { min: 70 } }, // Infant
    { ageMax: 3,    AF: { min: 20, max: 30 }, Puls: { min: 80,  max: 130 }, BT_systolic: { min: 80 } }, // Toddler
    { ageMax: 5,    AF: { min: 20, max: 25 }, Puls: { min: 80,  max: 120 }, BT_systolic: { min: 80 } }, // Preschool
    { ageMax: 12,   AF: { min: 15, max: 20 }, Puls: { min: 70,  max: 110 }, BT_systolic: { min: 90 } }, // School-age
    { ageMax: 18,   AF: { min: 12, max: 16 }, Puls: { min: 60,  max: 100 }, BT_systolic: { min: 90 } }  // Adolescent
];

const adultVitals = {
    AF: { min: 12, max: 20 },
    Puls: { min: 60, max: 100 },
    BT_systolic: { min: 90 },
    Saturation: { min: 95 },
    Temp: { yellow: 38.0, orange: 39.0, red: 40.0 }
};

function getVitalsForAge(age) {
    if (age === undefined || age === null || age >= 18) {
        return adultVitals;
    }
    const ranges = pediatricVitalsByAge.find(range => age <= range.ageMax);
    // Merge pediatric specifics with adult defaults (like Saturation)
    return ranges ? { ...adultVitals, ...ranges } : adultVitals;
}

export function getVitalColor(key, value, age) {
    const refs = getVitalsForAge(age);
    const red = '#FF5252', orange = '#FFC107', yellow = '#FFEE58';

    switch (key) {
        case 'AF':
            if (value > refs.AF.max + 10 || value < refs.AF.min - 8) return red;
            if (value > refs.AF.max + 5 || value < refs.AF.min - 4) return orange;
            if (value > refs.AF.max || value < refs.AF.min) return yellow;
            break;
        case 'Saturation':
            if (value < 90) return red;
            if (value < 92) return orange;
            if (value < 95) return yellow;
            break;
        case 'BT_systolic': // We'll use this key for the composite 'BT' display
            if (value < refs.BT_systolic.min - 20) return red;
            if (value < refs.BT_systolic.min - 10) return orange;
            if (value < refs.BT_systolic.min) return yellow;
            break;
        case 'Puls':
            if (value > refs.Puls.max + 40 || value < refs.Puls.min - 30) return red;
            if (value > refs.Puls.max + 20 || value < refs.Puls.min - 15) return orange;
            if (value > refs.Puls.max || value < refs.Puls.min) return yellow;
            break;
        case 'RLS':
            if (value > 1) return red;
            break;
        case 'Temp':
            const tempRefs = refs.Temp || adultVitals.Temp;
            if (value >= tempRefs.red) return red;
            if (value >= tempRefs.orange) return orange;
            if (value >= tempRefs.yellow) return yellow;
        break;
        
    }
    return null;
}

export function calculateAgeTriageLevel(vitals, age) {
    if (!vitals) return 'green';
    const refs = getVitalsForAge(age);

    // RÖD NIVÅ
    if (vitals.RLS > 1 || vitals.Saturation < 90 || vitals.BT_systolic < refs.BT_systolic.min) {
        return 'red';
    }
    // GUL NIVÅ
    if (vitals.AF > refs.AF.max + 5 || vitals.Puls > refs.Puls.max + 20 || vitals.Saturation < 95) {
        return 'yellow';
    }
    // GRÖN NIVÅ
    return 'green';
}