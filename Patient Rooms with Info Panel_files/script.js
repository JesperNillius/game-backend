
// --- NEW HELPER FUNCTION TO GENERATE WALLS ---

function generateWalls(rooms) {
  const walls = new Map(); // Use a Map to easily handle unique walls

  const addWall = (x1, y1, x2, y2) => {
    // Create a unique key for each wall, regardless of direction
    // e.g., a wall from (10,20) to (10,50) is the same as (10,50) to (10,20)
    const key = [x1, y1, x2, y2].sort().join(',');
    
    // If the wall doesn't exist, add it. If it does, it's an interior wall, so remove it.
    if (walls.has(key)) {
      walls.delete(key);
    } else {
      walls.set(key, { x1, y1, x2, y2 });
    }
  };

  // Generate all possible walls from every room
  rooms.forEach(room => {
    addWall(room.x, room.y, room.x + room.w, room.y); // Top
    addWall(room.x, room.y + room.h, room.x + room.w, room.y + room.h); // Bottom
    addWall(room.x, room.y, room.x, room.y + room.h); // Left
    addWall(room.x + room.w, room.y, room.x + room.w, room.y + room.h); // Right
  });

  // Return the final list of unique, external walls
  return Array.from(walls.values());
}

function drawBackground() {
  const outsideColor = '#344B34'; // Green grass color
  ctx.fillStyle = outsideColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// --- NEW DEBUG-READY DRAWING CODE ---

// Your existing lines
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const API_URL = 'http://localhost:3000';

// 1. Create an object to hold your images
const images = {
  waitingChair: new Image(),
  patientBed: new Image()
};

console.log("Step 1: Image objects created.");

// 2. Set the image sources with full URL
images.waitingChair.src = `${API_URL}/images/waiting_chair.png`;
images.patientBed.src = `${API_URL}/images/patient_bed.png`;

console.log("Step 2: Image sources set to:");
console.log(" - " + images.waitingChair.src);
console.log(" - " + images.patientBed.src);

// 3. Create the drawing function
// --- CORRECTED DRAWING FUNCTION WITH GREEN OUTSIDE AREA ---

// Change this function:
function drawHospitalLayout() {
  // Define all your colors and properties here
  // const outsideColor = '#344B34'; // << REMOVE THIS LINE
  const floorColor = '#F2E0C5';   // The gray for the interior floor
  const shadowColor = 'rgba(0, 0, 0, 0.3)';
  const shadowOffsetX = 7;
  const shadowOffsetY = 7;
  const wallColor = '#D1D1D1';

  // 1. Draw the "outside" green background across the entire canvas. << REMOVE THESE TWO LINES
  // ctx.fillStyle = outsideColor;
  // ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Draw the hospital's gray floor on top of the green.
  if (hospitalLayout && hospitalLayout.w > 0) {
    ctx.fillStyle = floorColor;
    ctx.fillRect(hospitalLayout.x, hospitalLayout.y, hospitalLayout.w, hospitalLayout.h);
  }

  // 3. Draw the wall shadows.
  walls.forEach(wall => {
    ctx.fillStyle = shadowColor;
    ctx.fillRect(wall.x + shadowOffsetX, wall.y + shadowOffsetY, wall.w, wall.h);
  });

  // 4. Draw the walls themselves.
  walls.forEach(wall => {
    ctx.fillStyle = wallColor;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
  });

  // 5. Draw furniture and room names.
  rooms.forEach(room => {
    // Draw furniture (with rotation logic)
    if (room.furniture) {
      room.furniture.forEach(item => {
        if (item.image && images[item.image] && images[item.image].complete) {
          const img = images[item.image];
          const imageWidth = item.w;
          const scaleFactor = imageWidth / img.naturalWidth;
          const imageHeight = img.naturalHeight * scaleFactor;

          ctx.save();
          ctx.translate(room.x + item.x + imageWidth / 2, room.y + item.y + imageHeight / 2);
          if (item.rotation) {
            ctx.rotate(item.rotation);
          }
          ctx.drawImage(img, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
          ctx.restore();

        } else if (item.color) {
          ctx.fillStyle = item.color;
          ctx.fillRect(room.x + item.x, room.y + item.y, item.w, item.h);
        }
      });
    }
    // Draw room name
    ctx.fillStyle = "#FFF";
    ctx.font = "16px Inter, Arial, sans-serif";
    ctx.fillText(room.name, room.x + 12, room.y + 22);
  });
}

// 4. Wait for images to load before drawing
console.log("Step 3: Setting up image load listeners...");

// Add error listeners to see if loading fails
images.waitingChair.onerror = () => console.error("ERROR: Failed to load waiting_chair.png");
images.patientBed.onerror = () => console.error("ERROR: Failed to load patient_bed.png");

Promise.all([
  new Promise(resolve => images.waitingChair.onload = resolve),
  new Promise(resolve => images.patientBed.onload = resolve)
]).then(() => {
  console.log("Step 4: SUCCESS! All images loaded.");
  drawHospitalLayout();
}).catch(error => {
  console.error("An error occurred while waiting for images:", error);
});

const DRAG_THRESHOLD = 5;
const vitalKeys = ["AF", "Saturation", "Puls", "BT", "Temp", "RLS"];
const standardFindings = {
  "Hjärta": "Regelbunden rytm, inga bi- eller blåsljud.",
  "Lungor": "Vesikulära andningsljud, inga rassel eller ronki.",
  "Buk": "Mjuk och oöm, normala tarmljud.",
  "Neurologi": "Vaken och klar, inga uppenbara fokala bortfall.",
  "Tyroidea": "Palperas normalstor och jämn.",
  "Mun & Svalg": "Normalfuktade slemhinnor, ingen rodnad.",
  "Lymfkörtlar": "Inga förstorade eller ömmande lymfkörtlar palperas.",
  "Underben": "Inga ödem eller hudförändringar."
};


let allLabTests = [];
let allBedsideTests = [];
let allMedications = [];
// In index.html -> <script> at the top
let vitalsPollTimer = null;

// In index.html -> <script>, add these two new functions

function stopVitalsPolling() {
  if (vitalsPollTimer) {
    clearInterval(vitalsPollTimer);
    vitalsPollTimer = null;
    console.log("Stopped polling for vitals.");
  }
}

async function pollForVitals(patientId) {
  try {
    const response = await fetch(`http://localhost:3000/patient/${patientId}/status`);
    if (!response.ok) return; // Don't stop polling, just skip this update

    const updatedVitals = await response.json();
    const patient = patients.find(p => p.id === patientId);
    if (!patient) return;

    // Update the local patient object's currentVitals
    patient.currentVitals = updatedVitals;

    // If the vitals popup is currently visible, refresh it
    const popup = document.getElementById('vitalsPopup');
    if (popup.style.display === 'block') {
      showVitalsPopup(patient);
    }

  } catch (error) {
    console.error("Vitals polling error:", error);
  }
}

function getRandomInRange(min, max, decimals) {
  const value = Math.random() * (max - min) + min;
  return value.toFixed(decimals);
}

function renderMedicationButtons(medsToRender) {
  const listContainer = document.getElementById('medsList');
  listContainer.innerHTML = ''; // Clear any old buttons

  medsToRender.forEach(med => {
    const button = document.createElement('button');
    button.textContent = med.name;
    button.dataset.medId = med.id; // Store the unique ID
    listContainer.appendChild(button);
  });
}


// In index.html -> <script>
// Replace your old 'rooms' array with this one.

// In index.html -> <script>
// Replace your entire 'rooms' array with this new layout.

const rooms = [
  // Waiting Room (tall, on the right)
  { x: 1060, y: 30, w: 200, h: 590, name: "Väntrum", furniture: [
    { x: 10, y: 20, w: 40, image: 'waitingChair' }, // Add w: 80 here
    { x: 10, y: 120, w: 40, image: 'waitingChair' }, // Add w: 80 here
    { x: 10, y: 430, w: 40, image: 'waitingChair' },
    { x: 10, y: 530, w: 40, image: 'waitingChair' }, 
    // Chairs to the left
    { x: 150, y: 20, w: 40, image: 'waitingChair', rotation: Math.PI }, // Add w: 80 here
    { x: 150, y: 120, w: 40, image: 'waitingChair', rotation: Math.PI },
    { x: 150, y: 220, w: 40, image: 'waitingChair', rotation: Math.PI },
    { x: 150, y: 320, w: 40, image: 'waitingChair', rotation: Math.PI },
    { x: 150, y: 420, w: 40, image: 'waitingChair', rotation: Math.PI },
    { x: 150, y: 520, w: 40, image: 'waitingChair', rotation: Math.PI },

  ]},
  
  // Corridor (long, in the middle)
  { x: 20, y: 250, w: 1020, h: 150, name: "Korridor", furniture: [] },
  
  // --- TOP ROW ---
  
  // Doctor's Expedition (new, top-left, slightly larger)
  { x: 20, y: 30, w: 260, h: 200, name: "Läkarexpedition", furniture: [
    { x: 40, y: 40, w: 180, h: 50, color: '#a1887f' }, // Desk
    { x: 105, y: 100, w: 40, h: 40, color: '#6d4c41' }, // Chair
  ]},
  
  // Top row of patient rooms (shifted to the right)
  { x: 300, y: 30, w: 240, h: 200, name: "Room 1", furniture: [
      { x: 180, y: 40, w: 60, h: 85, image: 'patientBed' } 
  ]},
  { x: 560, y: 30, w: 240, h: 200, name: "Room 2", furniture: [
      { x: 180, y: 40, w: 60, h: 85, image: 'patientBed' } 
  ]},
  { x: 820, y: 30, w: 220, h: 200, name: "Room 3", furniture: [
     { x: 160, y: 40, w: 60, h: 85, image: 'patientBed' } 
  ]},
  
  // --- BOTTOM ROW ---

  // New Patient Room (bottom-left)
  { x: 20, y: 420, w: 240, h: 200, name: "Room 4", furniture: [
      { x: 180, y: 40, w: 60, h: 85, image: 'patientBed' } 
  ]},

  // Bottom row of patient rooms (shifted to the right)
  { x: 280, y: 420, w: 240, h: 200, name: "Room 5", furniture: [
  { x: 180, y: 40, w: 60, h: 85, image: 'patientBed' } 
  ]},
  { x: 540, y: 420, w: 240, h: 200, name: "Room 6", furniture: [
    { x: 180, y: 40, w: 60, h: 85, image: 'patientBed' } 
  ]},
  { x: 800, y: 420, w: 240, h: 200, name: "Room 7", furniture: [
   { x: 180, y: 40, w: 60, h: 85, image: 'patientBed' } 
  ]},
];

// Add this new array to your script, after the 'rooms' array.
const walls = [
  
  // MOST LEFT VERTICAL WALL
  { x: 0, y: 0, w: 20, h: 650 },

  // MOST LEFT VERTICAL WALL
  { x: 1260, y: 0, w: 40, h: 650 },

  // Vertical wall between läkarexpedition and Room 1
  { x: 280, y: 30, w: 20, h: 200 },

  // Vertical wall between Room 1 & 2
  { x: 540, y: 30, w: 20, h: 200 },

  // Vertical wall between Room 2 & 3
  { x: 800, y: 30, w: 20, h: 200 },

  // Vertical wall between Room 3 & väntrum
  { x: 1040, y: 30, w: 20, h: 200 },

  // Vertical wall between Room 4 & 5
  { x: 260, y: 420, w: 20, h: 200 },

  // Vertical wall between Room 4 & 5
  { x: 520, y: 420, w: 20, h: 200 },

  // Vertical wall between Room 6 & 7
  { x: 780, y: 420, w: 20, h: 200 },

  // Vertical wall between Room 7 & väntrum
  { x: 1040, y: 420, w: 20, h: 200 },

  // TOP HORISONTALL WALL
  { x: 20, y: 0, w: 1280, h: 30 },

  // BOTTOM HORISONTALL WALL
  { x: 20, y: 620, w: 1280, h: 30 },

  // A horizontal wall below the top row of rooms
  { x: 20, y: 230, w: 1040, h: 20 },

  // A horizontal wall below the top row of rooms
  { x: 20, y: 400, w: 1040, h: 20 },

  // ... continue adding all the walls you need
];

// ... after your 'rooms' array definition
const hospitalWalls = generateWalls(rooms);
// Calculate the bounding box of the entire layout
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
rooms.forEach(room => {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.w);
    maxY = Math.max(maxY, room.y + room.h);
});
// Store the result in a convenient object
// Make sure this calculation is in your script, after 'rooms' and 'walls' are defined.

const hospitalLayout = {};
if (rooms.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rooms.forEach(room => {
        minX = Math.min(minX, room.x);
        minY = Math.min(minY, room.y);
        maxX = Math.max(maxX, room.x + room.w);
        maxY = Math.max(maxY, room.y + room.h);
    });
    hospitalLayout.x = minX;
    hospitalLayout.y = minY;
    hospitalLayout.w = maxX - minX;
    hospitalLayout.h = maxY - minY;
}// This line automatically sets the new waiting room as the spawn point
const spawnRoom = rooms[0];

let patients = [];
let draggingPatient = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isDraggingFlag = false;
let dragStartX = 0; 
let dragStartY = 0;
let patientData = [];
let patientIndex = 0;
const dataBadge = document.getElementById("dataBadge");

function inRoom(room, x, y) {
  return x > room.x && x < room.x + room.w && y > room.y && y < room.y + room.h;
}
function findRoomAt(x, y) {
  return rooms.find(r => inRoom(r, x, y)) || null;
}
function isRoomOccupied(room, exceptPatient = null) {
  if (room === spawnRoom) return false;
  for (const p of patients) {
    if (p === exceptPatient) continue;
    if (inRoom(room, p.x, p.y)) return true;
  }
  return false;
}

// In index.html -> <script>
// Delete the old drawing functions and use this one instead.


function drawPatients() {
  for (const p of patients) {
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "13px Arial";
    ctx.textAlign = "center";

    // Find the name from multiple possible properties
    const patientName = p.name || p.Name || p.Namn || "Unknown";

    ctx.fillText(patientName, p.x, p.y - p.radius - 6);
  }
}


async function spawnPatient() {
  const pad = 20;
  const x = spawnRoom.x + pad + Math.random() * (spawnRoom.w - pad*2);
  const y = spawnRoom.y + pad + Math.random() * (spawnRoom.h - pad*2);

  try {
    const res = await fetch("http://localhost:3000/random-patient");
    
    // ✅ Add this check!
    if (!res.ok) {
      if (res.status === 404) {
        alert("Congratulations! The last patient for the night just entered.");
        clearInterval(spawnTimer); // Stop trying to spawn more
      }
      throw new Error("Server responded with an error");
    }

    const patientData = await res.json();
    console.log("Patient data received by frontend:", patientData); 

    const newPatient = {
      x, y, radius: 14, color: "red", 
       actionsTaken: [],
       ...patientData
    };
    patients.push(newPatient);
    console.log("Spawned new patient:", newPatient);

  } catch (err) {
    console.error("Error fetching patient:", err);
  }
}


/* === Dragging === */
canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const vitalsPopup = document.getElementById('vitalsPopup');
  let patientClicked = false;

  // Check for click on a patient
  for (let i = patients.length - 1; i >= 0; i--) {
    const p = patients[i];
    const dx = mx - p.x, dy = my - p.y;
    if (Math.hypot(dx, dy) <= p.radius) {
      patientClicked = true;

      // Ctrl+Click or Right-Click shows the main info panel
      if (e.ctrlKey || e.button !== 0) {
        showPatientInfo(p);
      } 
      // A normal left-click will now PREPARE to drag
      else {
        draggingPatient = p;
        dragOffsetX = dx;
        dragOffsetY = dy;
        isDraggingFlag = false; // Reset the flag

        // ✅ Record the starting mouse position
        dragStartX = mx;
        dragStartY = my;
        
        // Move patient to the end of the array to draw it on top
        patients.splice(i, 1);
        patients.push(p);
      }
      return;
    }
  }

    // If the loop finishes, no patient was clicked, AND we are zoomed out...
    if (!patientClicked) {
  // Always hide the sub-menus on a background click
  document.getElementById('physicalExamMenu').style.display = 'none';
  document.getElementById('labMenu').style.display = 'none';
  document.getElementById('chatWindow').style.display = 'none';
  document.getElementById('medsMenu').style.display = 'none';
  document.getElementById('bedsideMenu').style.display = 'none';
  
  // Only hide the main vitals panel if we are in the zoomed-out view
  if (zoomFactor === 1) {
    vitalsPopup.style.display = 'none';
    hidePatientInfo();
  }
}
});

canvas.addEventListener("mousemove", (e) => {
  if (!draggingPatient) return;

  const rect = canvas.getBoundingClientRect();
  const currentMx = e.clientX - rect.left;
  const currentMy = e.clientY - rect.top;

  // Check if the mouse has moved beyond the threshold
  if (!isDraggingFlag) { // Only check if we haven't already started dragging
    const distance = Math.hypot(currentMx - dragStartX, currentMy - dragStartY);
    if (distance > DRAG_THRESHOLD) {
      isDraggingFlag = true;
    }
  }

  // This part of the code runs regardless, so the patient always follows the cursor
  let newX = e.clientX - rect.left - dragOffsetX;
  let newY = e.clientY - rect.top - dragOffsetY;
  newX = Math.max(draggingPatient.radius, Math.min(canvas.width - draggingPatient.radius, newX));
  newY = Math.max(draggingPatient.radius, Math.min(canvas.height- draggingPatient.radius, newY));
  
  const targetRoom = findRoomAt(newX, newY);
  if (targetRoom) {
    if (targetRoom === spawnRoom || !isRoomOccupied(targetRoom, draggingPatient)) {
      draggingPatient.x = newX;
      draggingPatient.y = newY;
    }
  } else {
    draggingPatient.x = newX;
    draggingPatient.y = newY;
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (draggingPatient) {
    // This block handles a completed DRAG operation
    if (isDraggingFlag) {
      const dropRoom = findRoomAt(draggingPatient.x, draggingPatient.y);
      if (dropRoom && dropRoom !== spawnRoom) {
        // Snap them to the center
        draggingPatient.x = dropRoom.x + dropRoom.w / 2;
        draggingPatient.y = dropRoom.y + dropRoom.h / 2;
        // Set them as the active patient
        currentPatientId = draggingPatient.id;

      }
    } 
    // This block handles a CLICK without dragging
    else {
      // ✅ The condition checking for the spawn room has been removed.
      // This will now show the vitals pop-up on any quick click.
      showVitalsPopup(draggingPatient);
    }
  }
  
  // Finalize the operation by resetting the state
  draggingPatient = null;
  isDraggingFlag = false;
});

/* === Info panel === */
const panel = document.getElementById("infoPanel");
const infoName = document.getElementById("infoName");
const infoDetails = document.getElementById("infoDetails");
document.getElementById("closeInfo").addEventListener("click", hidePatientInfo);
document.addEventListener("keydown", (e) => { if (e.key==="Escape") hidePatientInfo(); });

function showPatientInfo(patient) {
  currentPatientId = patient.id;  // 🔹 set active patient
  infoName.textContent = patient.Namn || patient.name || "Okänd patient";
  infoDetails.innerHTML = "";
  for (const [key, val] of Object.entries(patient)) {
    if (["x","y","radius","color"].includes(key)) continue;
    const div = document.createElement("div");
    div.textContent = `${key}: ${val}`;
    infoDetails.appendChild(div);
  }
  panel.classList.add("open");
}

function hidePatientInfo() {
  panel.classList.remove("open");
}

function showVitalsPopup(patient) {
  const popup = document.getElementById('vitalsPopup');
  const vitalsTitle = document.getElementById('vitalsTitle');
  const vitalsContent = document.getElementById('vitalsContent');
  const physExamContent = document.getElementById('physExamContent');
  const labContent = document.getElementById('labResultsContent');
  const medsContent = document.getElementById('administeredMedsContent');
  const bedsideContent = document.getElementById('bedsideTestContent');

  // 1. Clear all previous content
  vitalsContent.innerHTML = '';
  physExamContent.innerHTML = '';
  labContent.innerHTML = '';
  medsContent.innerHTML = '';
  bedsideContent.innerHTML = '';
  const oldComplaint = popup.querySelector('.chief-complaint');
  if (oldComplaint) oldComplaint.remove();

  // 2. Populate all the content sections
  const patientName = patient.name || "Okänd Patient";
  const patientAge = patient.age;
  let titleText = patientName;
  if (patientAge) titleText += `, ${patientAge} år`;
  vitalsTitle.textContent = titleText;

  const chiefComplaint = patient.Kontaktorsak;
  if (chiefComplaint) {
    const complaintElement = document.createElement('p');
    complaintElement.className = 'chief-complaint';
    complaintElement.textContent = chiefComplaint;
    document.getElementById('vitalsHeader').appendChild(complaintElement);
  }

  const vitalsSource = patient.currentVitals || patient;

  vitalKeys.forEach(key => {
    // ✅ Add a special case for Blood Pressure (BT)
    if (key === "BT") {
      // Check if the new systolic/diastolic values exist
      if (vitalsSource.BT_systolic !== undefined && vitalsSource.BT_diastolic !== undefined) {
        const dataRow = document.createElement('div');
        const systolic = Math.round(vitalsSource.BT_systolic);
        const diastolic = Math.round(vitalsSource.BT_diastolic);
        dataRow.textContent = `BT: ${systolic}/${diastolic}`;
        vitalsContent.appendChild(dataRow);
      }
    } 
    else if (key === "Temp") {
      if (vitalsSource.Temp !== undefined && vitalsSource.Temp !== null) {
        const dataRow = document.createElement('div');
        // Use .toFixed(1) to format to one decimal place
        const formattedTemp = parseFloat(vitalsSource.Temp).toFixed(1);
        dataRow.textContent = `Temp: ${formattedTemp}`;
        vitalsContent.appendChild(dataRow);
      }
    }
    else if (vitalsSource[key] !== undefined && vitalsSource[key] !== null) {
      const dataRow = document.createElement('div');
      // ✅ Round the value before displaying it
      const roundedValue = Math.round(vitalsSource[key]);
      dataRow.textContent = `${key}: ${roundedValue}`;
      vitalsContent.appendChild(dataRow);
    }
  });
  
  updateAdministeredMedsUI(patient);
  updateBedsideTestsUI(patient);
  updateLabResultsUI(patient);
  // Rebuild the list of performed physical exams
  if (patient.performedExams) {
    Object.entries(patient.performedExams).forEach(([examType, resultText]) => {
      const isAbnormal = !Object.values(standardFindings).includes(resultText);
      const resultId = `phys-result-${examType.replace(/\s+/g, '-')}`;
      const resultRow = document.createElement('div');
      resultRow.id = resultId;
      resultRow.innerHTML = `<strong>${examType}:</strong> ${resultText}`;
      resultRow.style.color = isAbnormal ? '#ff6b6b' : '';
      physExamContent.appendChild(resultRow);
    });
  }
  
  // 3. Show the pop-up so the browser knows it's visible
  popup.style.display = 'flex';

  // 4. Use a timeout to set the accordion state AFTER the browser has rendered the content
  setTimeout(() => {
    // Find all accordion headers inside the popup
    const headers = popup.querySelectorAll('.accordion-header');

    headers.forEach(header => {
        // Check if a header is already open
        if (header.classList.contains('active')) {
            const content = header.nextElementSibling;
            // If it's open, just update its height to fit any new content (like new lab results)
            content.style.maxHeight = content.scrollHeight + "px";
        }
    });
}, 0);
}


function updateLabResultsUI(patient) {
  const labContent = document.getElementById('labResultsContent');
  labContent.innerHTML = ''; // Rensa alltid först

  if (patient.orderedLabs) {
    Object.entries(patient.orderedLabs).forEach(([testId, resultText]) => {
      const testInfo = allLabTests.find(t => t.id === testId);
      if (testInfo) {
        const specificFinding = patient[testInfo.name];
        const isAbnormal = !!specificFinding;
        
        const resultId = `lab-result-${testInfo.id}`;
        const resultRow = document.createElement('div');
        resultRow.id = resultId;
        resultRow.innerHTML = `<strong>${testInfo.name}:</strong> ${resultText}`;
        resultRow.style.color = isAbnormal ? '#ff6b6b' : '';
        labContent.appendChild(resultRow);
      }
    });
  }
}

function updateAdministeredMedsUI(patient) {
  const medsContent = document.getElementById('administeredMedsContent');
  medsContent.innerHTML = ''; // Clear the list first

  if (patient.administeredMeds && patient.administeredMeds.length > 0) {
    patient.administeredMeds.forEach(medName => {
      const medRow = document.createElement('div');
      medRow.textContent = `✓ ${medName}`; // Add a checkmark for clarity
      medsContent.appendChild(medRow);
    });
  }
}

// === Zoom variables ===
let zoomFactor = 1;
let zoomTarget = null;
let zoomAnim = null;

// Double click to zoom in on a room
canvas.addEventListener("dblclick", (e) => {
  console.log("1. Double-click detected on canvas."); // Probe 1
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const clickedRoom = findRoomAt(mx, my);

  if (clickedRoom) {
    console.log("2. A room was clicked:", clickedRoom.name); // Probe 2
    
    zoomTarget = {
      x: clickedRoom.x + clickedRoom.w / 2,
      y: clickedRoom.y + clickedRoom.h / 2
    };
    animateZoom(2.5);

    const patientInRoom = patients.find(p =>
      p.x >= clickedRoom.x && p.x <= clickedRoom.x + clickedRoom.w &&
      p.y >= clickedRoom.y && p.y <= clickedRoom.y + clickedRoom.h
    );

    if (patientInRoom) {
      console.log("3. SUCCESS: Found a patient in the room. Showing menus."); // Probe 3
      currentPatientId = patientInRoom.id;
      document.getElementById("physicalExamMenu").style.display = "none";
      document.getElementById("labMenu").style.display = "none";
      showVitalsPopup(patientInRoom);
      document.getElementById("roomMenu").style.display = "block";
      console.log(`Starting to poll vitals for patient ${patientInRoom.id}`);
      vitalsPollTimer = setInterval(() => pollForVitals(patientInRoom.id), 3000); // Check every 3 seconds
    } else {
      console.log("3. No patient was found in this room."); // Probe 4
      currentPatientId = null;
      document.getElementById("roomMenu").style.display = "none";
    }

  } else {
    console.log("2. No room was clicked (clicked on background). Zooming out."); // Probe 5
    animateZoom(1, null);
    hideAllSideMenus();
  }
});

function hideAllSideMenus() {
  // hide all the menus
  document.getElementById("roomMenu").style.display = "none";
  document.getElementById("physicalExamMenu").style.display = "none";
  document.getElementById("labMenu").style.display = "none";
  document.getElementById("vitalsPopup").style.display = "none";
  document.getElementById("chatWindow").style.display = "none";
  document.getElementById("medsMenu").style.display = "none";
  document.getElementById("bedsideMenu").style.display = "none";
 feedbackModal.classList.remove('visible'); // ✅ Corrected line
}

// Esc to zoom out
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    animateZoom(1, null);
    hideAllSideMenus(); // ✅ Use the new, clean function
    stopVitalsPolling(); // ✅ STOP POLLING on zoom out

  }
});


// Smooth zoom animation
function animateZoom(targetFactor, targetRoom = zoomTarget) {
  if (zoomAnim) cancelAnimationFrame(zoomAnim);
  const start = zoomFactor;
  const end = targetFactor;
  const duration = 400;
  const startTime = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    zoomFactor = start + (end - start) * t;
    if (t < 1) zoomAnim = requestAnimationFrame(step);
    else zoomAnim = null;
    if (targetRoom === null && end === 1) zoomTarget = null;
  }
  requestAnimationFrame(step);
}

document.getElementById("resetBtn").addEventListener("click", async () => {
  try {
    await fetch("http://localhost:3000/reset", { method: 'POST' });
    
    // Stop the timer and clear the board
    if (spawnTimer) clearInterval(spawnTimer);
    spawnTimer = null;
    patients = [];
    
    // Show the main menu and hide the pop-up correctly
    document.getElementById('menu').style.display = 'block';
    feedbackModal.classList.remove('visible'); // ✅ Corrected line

  } catch (err) {
    console.error("Failed to reset the game:", err);
    alert("Error: Could not start a new game.");
  }
});

// === Main loop ===
function loop() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transforms

    drawBackground();

  if (zoomTarget) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoomFactor, zoomFactor);
    ctx.translate(-zoomTarget.x, -zoomTarget.y);
  }

  // ✅ Always draw rooms and patients after transforms
  drawHospitalLayout();
  drawPatients();

  requestAnimationFrame(loop);
}
loop(); // <--- make sure we call it once to start

let currentPatientId = 1; // default, can be randomized or selected later

let spawnTimer = null;
document.getElementById("playBtn").addEventListener("click", async () => {
  try {
    const response = await fetch("http://localhost:3000/api/game-data");
    const data = await response.json();

    // Populate our empty arrays with data from the server
    allLabTests = data.labTests;
    allBedsideTests = data.bedsideTests;
    allMedications = data.medications;

    console.log("Game data loaded successfully!");

  } catch (error) {
    console.error("Failed to load game data:", error);
    alert("Could not load game data from the server. Please check the console.");
    return; // Stop if data loading fails
  }
  document.getElementById("menu").style.display = "none";
  if (spawnTimer) clearInterval(spawnTimer);
  spawnTimer = setInterval(spawnPatient, 15000);
  spawnPatient();
});

document.getElementById("settingsBtn").addEventListener("click", () => {
  alert("No settings yet!");
});

// Show chat window when Anamnesis clicked
// Replace your old button listeners with these

document.getElementById("btnAnamnesis").addEventListener("click", () => {
  showSubmenu('chatWindow');

  // Any specific logic for Anamnesis can still go here
  const chatMessages = document.getElementById("chatMessages");
  const currentPatient = patients.find(p => p.id === currentPatientId);

  if (currentPatient && currentPatient.chatHistory) {
    chatMessages.innerHTML = currentPatient.chatHistory;
  } else {
    chatMessages.innerHTML = '';
    const patientName = currentPatient ? (currentPatient.name || currentPatient.Name) : "this patient";
    addChatMessage("System", `Anamnesis started with ${patientName}.`);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

document.getElementById("btnPhysical").addEventListener("click", () => {
  showSubmenu('physicalExamMenu');
});

document.getElementById("btnBedside").addEventListener("click", () => {
  showSubmenu('bedsideMenu');
});

document.getElementById("btnLab").addEventListener("click", () => {
  showSubmenu('labMenu');
});

document.getElementById("btnMeds").addEventListener("click", () => {
  showSubmenu('medsMenu');
});

function showSubmenu(menuIdToShow) {
  // An array of all possible submenu IDs
  const allSubmenuIds = [
    'physicalExamMenu',
    'labMenu',
    'chatWindow',
    'medsMenu',
    'bedsideMenu'
  ];

  // First, hide all submenus
  allSubmenuIds.forEach(id => {
    const menu = document.getElementById(id);
    if (menu) {
      menu.style.display = 'none';
    }
  });

  // Now, find the specific menu to show
  const menuToShow = document.getElementById(menuIdToShow);
  if (!menuToShow) {
    return; // Exit if the menuId is invalid or null
  }
  
  // Before showing the menu, render its content
  switch (menuIdToShow) {
    case 'labMenu':
      renderLabTestButtons(allLabTests);
      break;
    case 'medsMenu':
      renderMedicationButtons(allMedications);
      break;
    case 'bedsideMenu':
      renderBedsideTestButtons(allBedsideTests);
      break;
    // Add other cases here if they need pre-rendering
  }

  // Finally, show the requested menu
  // Special case for the chat window which uses flexbox
  if (menuIdToShow === 'chatWindow') {
    menuToShow.style.display = 'flex';
  } else {
    menuToShow.style.display = 'block';
  }
}

const labSearchInput = document.getElementById('labSearchInput');

labSearchInput.addEventListener('input', () => {
  // 1. Get the current text from the search box and make it lowercase
  const searchTerm = labSearchInput.value.toLowerCase();

  // 2. Filter the master 'allLabTests' array
  const filteredTests = allLabTests.filter(test => {
    // Keep only the tests whose names include the search term
    return test.name.toLowerCase().includes(searchTerm);
  });

  // 3. Re-render the button list with only the filtered results
  renderLabTestButtons(filteredTests);
});

const medsSearchInput = document.getElementById('medsSearchInput');

medsSearchInput.addEventListener('input', () => {
  // 1. Get the search term
  const searchTerm = medsSearchInput.value.toLowerCase();

  // 2. Filter the master list
  const filteredMeds = allMedications.filter(med => {
    return med.name.toLowerCase().includes(searchTerm);
  });

  // 3. Re-render the button list
  renderMedicationButtons(filteredMeds);
});

// Handle sending messages
document.getElementById("sendBtn").addEventListener("click", async () => {
  const input = document.getElementById("chatInput");
  const userMessage = input.value.trim();
  if (!userMessage) return;

  // Anropa den uppdaterade funktionen som nu även sparar
  addChatMessage("You", userMessage);
  input.value = "";

  try {
    const response = await fetch("http://localhost:3000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        message: userMessage, 
        patientId: currentPatientId 
      })
    });

    const data = await response.json();
    
    // Anropa den uppdaterade funktionen som nu även sparar
    addChatMessage("Patient", data.reply);

  } catch (err) {
    console.error(err);
    addChatMessage("System", "Error contacting patient!");
  }
});

const chatInput = document.getElementById('chatInput');

chatInput.addEventListener('keydown', (e) => {
  // Check if the key that was pressed was the 'Enter' key
  if (e.key === 'Enter') {
    // Prevent the default Enter action (like adding a new line in a form)
    e.preventDefault(); 
    
    // Trigger a click on the Send button
    document.getElementById('sendBtn').click();
  }
});

// Helper to display messages
function addChatMessage(sender, text) {
  const box = document.getElementById("chatMessages");
  
  // Create the bubble div
  const div = document.createElement("div");
  div.classList.add("chat-bubble"); // Add the base class

  // Add a specific class based on the sender
  if (sender === 'You') {
    div.classList.add('user-bubble');
  } else {
    // This will apply to 'Patient' and 'System' messages
    div.classList.add('patient-bubble');
  }

  // Set the message text inside the bubble
  div.textContent = text;
  
  // Add the new bubble to the chat box
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;

  // --- Real-time Save Logic (from before) ---
  if (currentPatientId != null) {
    const patient = patients.find(p => p.id === currentPatientId);
    if (patient) {
      patient.chatHistory = box.innerHTML;
    }
  }
}

document.getElementById("physicalExamMenu").addEventListener("click", (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  const examType = button.dataset.exam;
  const currentPatient = patients.find(p => p.id === currentPatientId);
  if (!currentPatient) return;

  // ✅ Denna rad är nu korrigerad. Den letar nu efter t.ex. "Buk" istället för "Status Buk".
  const columnName = examType; 

  if (!currentPatient.performedExams) {
    currentPatient.performedExams = {};
  }
  
  const specificFinding = currentPatient[columnName];
  const resultText = specificFinding || standardFindings[examType];
  
  // Spara resultatet och spåra åtgärden
  currentPatient.performedExams[examType] = resultText;
  if (!currentPatient.actionsTaken.includes(examType)) {
    currentPatient.actionsTaken.push(examType);
  }
  
  // Uppdatera UI och öppna accordion
  updatePhysicalExamUI(currentPatient);
  const container = document.getElementById('physExamContent');
  const header = container.previousElementSibling;
  header.classList.add("active");
  container.style.maxHeight = container.scrollHeight + "px";
});

function updatePhysicalExamUI(patient) {
  const examContent = document.getElementById('physExamContent');
  examContent.innerHTML = ''; // Rensa alltid listan först

  if (patient.performedExams) {
    Object.entries(patient.performedExams).forEach(([examType, resultText]) => {
      const isAbnormal = !Object.values(standardFindings).includes(resultText);
      const resultRow = document.createElement('div');
      resultRow.innerHTML = `<strong>${examType}:</strong> ${resultText}`;
      // Sätt färgen till röd om fyndet är avvikande (inte ett standardfynd)
      resultRow.style.color = isAbnormal ? '#ff6b6b' : '';
      examContent.appendChild(resultRow);
    });
  }
}

document.getElementById("labMenu").addEventListener("click", (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  const testId = button.dataset.testId;
  const testInfo = allLabTests.find(t => t.id === testId);
  if (!testInfo) return;

  const currentPatient = patients.find(p => p.id === currentPatientId);
  if (!currentPatient) return;

  if (!currentPatient.orderedLabs) {
    currentPatient.orderedLabs = {};
  }
  
  const processTest = (subTestInfo) => {
    const specificFinding = currentPatient[subTestInfo.name];
    let resultText;
    if (specificFinding) {
      resultText = specificFinding;
    } else {
      if (currentPatient.orderedLabs[subTestInfo.id]) {
        resultText = currentPatient.orderedLabs[subTestInfo.id];
      } else {
        const { min, max, unit, decimals } = subTestInfo.normalRange;
        const randomValue = getRandomInRange(min, max, decimals);
        resultText = `${randomValue} ${unit}`;
      }
    }
    currentPatient.orderedLabs[subTestInfo.id] = resultText;
    if (!currentPatient.actionsTaken.includes(subTestInfo.id)) {
    currentPatient.actionsTaken.push(subTestInfo.id);
    console.log("Action added:", subTestInfo.id, "Total actions:", currentPatient.actionsTaken); // Optional: for debugging
  }
  };

  if (testInfo.isPanel) {
    testInfo.subTests.forEach(subId => {
      const subTestInfo = allLabTests.find(t => t.id === subId);
      if (subTestInfo) processTest(subTestInfo);
    });
  } else {
    processTest(testInfo);
  }

  // ✅ Anropa den nya, fokuserade uppdateringsfunktionen
  updateLabResultsUI(currentPatient);

  // Tvinga labb-accordion att öppnas/ändra storlek
  const labContainer = document.getElementById('labResultsContent');
  const accordionHeader = labContainer.previousElementSibling;
  accordionHeader.classList.add("active");
  labContainer.style.maxHeight = labContainer.scrollHeight + "px";
});

function renderLabTestButtons(testsToRender) {
  const listContainer = document.getElementById('labTestList');

  // Clear any old buttons from the list
  listContainer.innerHTML = '';

  // Loop through the provided list of tests
  testsToRender.forEach(test => {
    // Create a new button element
    const button = document.createElement('button');
    
    // Set the button's text to the test name
    button.textContent = test.name;
    
    // Add a data-attribute to store the test's unique id
    button.dataset.testId = test.id;
    
    // Add the new button to the container in the HTML
    listContainer.appendChild(button);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Find ALL accordion headers
  const accordionHeaders = document.querySelectorAll(".accordion-header");

  // Add a click listener to EACH ONE
  accordionHeaders.forEach(header => {
    header.addEventListener("click", function() {
      this.classList.toggle("active");
      const content = this.nextElementSibling;
      if (content.style.maxHeight) {
        content.style.maxHeight = null;
      } else {
        content.style.maxHeight = content.scrollHeight + "px";
      }
    });
  });
});

document.getElementById("medsMenu").addEventListener("click", async (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  const medId = button.dataset.medId;
  const medInfo = allMedications.find(m => m.id === medId);
  if (!medInfo) return;

  const currentPatient = patients.find(p => p.id === currentPatientId);
  if (!currentPatient) return;

  // ✅ --- THIS IS THE NEW PART ---
  // Send the command to the server backend
  try {
    console.log(`Administering ${medInfo.name} to patient ${currentPatientId}...`);
    const response = await fetch(`http://localhost:3000/patient/${currentPatientId}/give-med`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medId: medId })
    });

    if (!response.ok) {
      throw new Error('Server responded with an error.');
    }

    const result = await response.json();
    console.log(result.message); // Should log "Ringer-Acetat administered."

  } catch (error) {
    console.error('Failed to administer medication:', error);
    alert('Could not administer medication. Check server console.');
  }
  // --- END OF NEW PART ---

  if (!currentPatient.administeredMeds) {
    currentPatient.administeredMeds = [];
  }

  if (!currentPatient.administeredMeds.includes(medInfo.name)) {
    currentPatient.administeredMeds.push(medInfo.name);
  }
  if (!currentPatient.actionsTaken.includes(medId)) {
    currentPatient.actionsTaken.push(medId);
  }
  
  updateAdministeredMedsUI(currentPatient);

  const medsContainer = document.getElementById('administeredMedsContent');
  const accordionHeader = medsContainer.previousElementSibling;
  accordionHeader.classList.add("active");
  medsContainer.style.maxHeight = medsContainer.scrollHeight + "px";
});

// --- Discharge and Feedback UI Logic ---

// --- Discharge and Feedback UI Logic ---
const dispositionModal = document.getElementById('dispositionModal');
const feedbackModal = document.getElementById('feedbackModal');

// Find this existing listener
document.getElementById('btnDischarge').addEventListener('click', () => {
  // It should now show the diagnosisModal, not the dispositionModal
  document.getElementById('diagnosisInput').value = ''; // Clear previous input
  document.getElementById('diagnosisModal').classList.add('visible');
});

document.getElementById('btnCancelDisposition').addEventListener('click', () => {
  dispositionModal.classList.remove('visible');
});

document.getElementById('btnSendHome').addEventListener('click', () => handleDispositionChoice('Home'));
document.getElementById('btnAdmitWard').addEventListener('click', () => handleDispositionChoice('Ward'));

document.getElementById('closeFeedback').addEventListener('click', () => {
  feedbackModal.classList.remove('visible');
});

// Add these new listeners with your other ones

document.getElementById('btnCancelDiagnosis').addEventListener('click', () => {
  document.getElementById('diagnosisModal').classList.remove('visible');
});

document.getElementById('btnConfirmDiagnosis').addEventListener('click', () => {
  const currentPatient = patients.find(p => p.id === currentPatientId);
  if (!currentPatient) return;

  // 1. Get the player's diagnosis from the input field
  const playerDiagnosis = document.getElementById('diagnosisInput').value;

  // 2. Save it to the patient object for later
  currentPatient.playerDiagnosis = playerDiagnosis;

  // 3. Hide the diagnosis modal and show the disposition modal
  document.getElementById('diagnosisModal').classList.remove('visible');
  document.getElementById('dispositionModal').classList.add('visible');
});

function getActionNameById(id) {
  const labTest = allLabTests.find(t => t.id === id);
  if (labTest) return labTest.name;

  const med = allMedications.find(m => m.id === id);
  if (med) return med.name;
  
  const bedsideTest = allBedsideTests.find(t => t.id === id);
  if (bedsideTest) return bedsideTest.name;

  // For physical exams, the id is the name
  if (standardFindings[id]) return id;

  return id; // Fallback to the id if not found
}

// Ritar ut knapparna i bedside-menyn
function renderBedsideTestButtons(testsToRender) {
  const listContainer = document.getElementById('bedsideTestList');
  listContainer.innerHTML = ''; 

  testsToRender.forEach(test => {
    const button = document.createElement('button');
    button.textContent = test.name;
    button.dataset.testId = test.id;
    listContainer.appendChild(button);
  });
}

// Uppdaterar UI med utförda bedside-tester
function updateBedsideTestsUI(patient) {
  const bedsideContent = document.getElementById('bedsideTestContent');
  bedsideContent.innerHTML = ''; 

  if (patient.performedBedsideTests) {
    Object.entries(patient.performedBedsideTests).forEach(([testName, resultText]) => {
      const resultRow = document.createElement('div');
      resultRow.innerHTML = `<strong>${testName}:</strong> ${resultText}`;
      // You can add logic here to color-code abnormal results if you want
      bedsideContent.appendChild(resultRow);
    });
  }
}

console.log("Försöker hitta #bedsideMenu:", document.getElementById("bedsideMenu"));


// Replace your existing listener for #bedsideMenu with this one

document.getElementById("bedsideMenu").addEventListener("click", (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  const testId = button.dataset.testId;
  if (!testId) return;

  const currentPatient = patients.find(p => p.id === currentPatientId);
  if (!currentPatient) return;

  if (testId === 'ekg') {
    const modal = document.getElementById('ekgModal');
    const img = document.getElementById('ekgImage');
    const interpretationDiv = document.getElementById('ekgInterpretation');
    const interpretationText = document.getElementById('ekgInterpretationText');

    // DEBUG: Let's see what the script finds.
    console.log("Found image element:", img); 

    if (!img) {
      alert("Error: Could not find the HTML element with id='ekgImage'. Check for typos in your HTML file.");
      return;
    }

    if (currentPatient.EKG_image_filename) {
      img.src = `http://localhost:3000/images/${currentPatient.EKG_image_filename}`;
      interpretationText.textContent = currentPatient.EKG_finding_text || "No interpretation available.";
      interpretationDiv.style.display = 'none';
      modal.classList.add('visible');
    } else {
      alert("No EKG image available for this patient.");
    }
  } else {
    // This is the existing logic for other bedside tests
    if (!currentPatient.performedBedsideTests) {
      currentPatient.performedBedsideTests = {};
    }
    const testInfo = allBedsideTests.find(t => t.id === testId);
    if (!testInfo) return;
    const specificFinding = currentPatient[testInfo.name];
    const resultText = specificFinding || testInfo.normalFinding;
    currentPatient.performedBedsideTests[testInfo.name] = resultText;
    if (!currentPatient.actionsTaken.includes(testId)) {
      currentPatient.actionsTaken.push(testId);
    }
    updateBedsideTestsUI(currentPatient);
    const container = document.getElementById('bedsideTestContent');
    const header = container.previousElementSibling;
    header.classList.add("active");
    container.style.maxHeight = container.scrollHeight + "px";
  }
});

function categorizeActions(actionIdArray) {
  const categories = { exams: [], labs: [], meds: [], bedside: [] };
  const actionSet = new Set(actionIdArray);

  actionSet.forEach(id => {
    if (allLabTests.some(test => test.id === id)) {
      categories.labs.push(id);
    } else if (allMedications.some(med => med.id === id)) {
      categories.meds.push(id);
    } else if (allBedsideTests.some(test => test.id === id)) {
      categories.bedside.push(id);
    } else if (standardFindings[id]) {
      categories.exams.push(id);
    }
  });
  return categories;
}

function handleDispositionChoice(playerChoice) {
  try {
    const currentPatient = patients.find(p => p.id === currentPatientId);
    if (!currentPatient) return;

    const feedbackContent = document.getElementById('feedbackContent');
    let reportHTML = '';

    // ✅ --- ADD THIS NEW SECTION FOR DIAGNOSIS FEEDBACK ---
    reportHTML += '<h4>Diagnosis</h4>';
    const playerDiag = (currentPatient.playerDiagnosis || "No diagnosis given").trim().toLowerCase();
    const correctDiag = (currentPatient['Correct diagnosis'] || "").trim().toLowerCase();

    if (playerDiag === correctDiag) {
      reportHTML += `<div class="feedback-task correct"><span class="task-icon">✓</span><span class="task-name">Correct Diagnosis: ${currentPatient['Correct diagnosis']}</span></div>`;
    } else {
      reportHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">Your Diagnosis: ${currentPatient.playerDiagnosis || "None"}</span></div>`;
      reportHTML += `<div class="feedback-task correct" style="margin-top: 5px;"><span class="task-icon">✓</span><span class="task-name">Correct Diagnosis: ${currentPatient['Correct diagnosis']}</span></div>`;
    }
    // --- END OF NEW SECTION ---

    const criticalActionIds = new Set(JSON.parse(currentPatient.ActionsCritical || '[]'));
    const recommendedActionIds = new Set(JSON.parse(currentPatient.ActionsRecommended || '[]'));
    const unnecessaryActionIds = new Set(JSON.parse(currentPatient.ActionsUnnecessary || '[]'));
    const playerActions = new Set(currentPatient.actionsTaken);

    // Helper function is now more specific
    const getActionType = (id) => {
      if (allMedications.some(med => med.id === id)) return 'åtgärd';
      if (standardFindings[id]) return 'status';
      if (allLabTests.some(test => test.id === id)) return 'lab';
      if (allBedsideTests.some(test => test.id === id)) return 'bedside';
      return 'okänd';
    };

    // --- Build 'Utredning' (Investigation) Section ---
    reportHTML += '<h2>Utredning</h2>';
    
    // -- Critical Investigations --
    reportHTML += '<h4>Kritiska Undersökningar</h4>';
    const criticalUtredningIds = [...criticalActionIds].filter(id => ['status', 'lab', 'bedside'].includes(getActionType(id)));
    
    // Sub-category: Status
    const criticalStatus = criticalUtredningIds.filter(id => getActionType(id) === 'status');
    if (criticalStatus.length > 0) {
      reportHTML += '<h5>Status:</h5>';
      criticalStatus.forEach(id => {
        if (playerActions.has(id)) {
          reportHTML += `<div class="feedback-task correct"><span class="task-icon">✓</span><span class="task-name">${getActionNameById(id)}</span></div>`;
        } else {
          reportHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${getActionNameById(id)}</span></div>`;
        }
      });
    }
    
    // Sub-category: Lab & Bedside
    const criticalLabBedside = criticalUtredningIds.filter(id => ['lab', 'bedside'].includes(getActionType(id)));
     if (criticalLabBedside.length > 0) {
      reportHTML += '<h5>Lab & Bedside:</h5>';
      criticalLabBedside.forEach(id => {
        if (playerActions.has(id)) {
          reportHTML += `<div class="feedback-task correct"><span class="task-icon">✓</span><span class="task-name">${getActionNameById(id)}</span></div>`;
        } else {
          reportHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${getActionNameById(id)}</span></div>`;
        }
      });
    }

    if (criticalUtredningIds.length === 0) {
      reportHTML += '<p>Inga kritiska undersökningar krävdes.</p>';
    }

    // --- Build 'Åtgärder' Section (remains the same) ---
    reportHTML += '<h2>Åtgärder</h2>';
    // ... (The rest of the function for Disposition and Åtgärder is the same as before)
    reportHTML += '<h4>Disposition</h4>';
    if (playerChoice === currentPatient.CorrectDischarge) {
      reportHTML += `<p class="feedback-correct">Korrekt: Patienten skickades till ${playerChoice}.</p>`;
    } else {
      reportHTML += `<p class="feedback-missed">Inkorrekt: Patienten borde ha skickats till ${currentPatient.CorrectDischarge}.</p>`;
    }
    
    reportHTML += '<h4>Kritiska Åtgärder</h4>';
    const criticalAtgarder = [...criticalActionIds].filter(id => getActionType(id) === 'åtgärd');
     if (criticalAtgarder.length > 0) {
      criticalAtgarder.forEach(id => {
        if (playerActions.has(id)) {
          reportHTML += `<div class="feedback-task correct"><span class="task-icon">✓</span><span class="task-name">${getActionNameById(id)}</span></div>`;
        } else {
          reportHTML += `<div class="feedback-task missed"><span class="task-icon">✗</span><span class="task-name">${getActionNameById(id)}</span></div>`;
        }
      });
    } else {
      reportHTML += '<p>Inga kritiska åtgärder krävdes.</p>';
    }


    // --- Display the Report ---
    dispositionModal.classList.remove('visible');
    feedbackContent.innerHTML = reportHTML;
    feedbackModal.classList.add('visible');

  } catch (err) {
    console.error("❌ ERROR generating feedback report:", err);
    alert("An error occurred while generating the feedback. Please check the console (F12) for details.");
  }
}

document.getElementById('closeFeedback').addEventListener('click', () => {
  document.getElementById('feedbackModal').style.display = 'none';
});


// ---- EKG ----
document.getElementById('showEkgInterpretationBtn').addEventListener('click', () => {
  const currentPatient = patients.find(p => p.id === currentPatientId);
  if (!currentPatient) return;

    console.log("Inspecting patient object:", currentPatient);


  // --- Action 1: Show the interpretation in the EKG modal ---
  document.getElementById('ekgInterpretation').style.display = 'block';

  // --- Action 2: Log the finding in the Vitals Panel ---
  const findingText = currentPatient.EKG_finding_text || "EKG performed.";

  // Ensure the storage object exists
  if (!currentPatient.performedBedsideTests) {
    currentPatient.performedBedsideTests = {};
  }

  // Add the EKG finding to the list of performed tests
  currentPatient.performedBedsideTests['EKG'] = findingText;

  // Refresh the UI in the vitals pop-up using your existing function
  updateBedsideTestsUI(currentPatient);

  // --- Action 3: Automatically open the "Bedside Tests" accordion ---
  const container = document.getElementById('bedsideTestContent');
  const header = container.previousElementSibling;
  
  // Open the accordion if it's not already open
  if (!header.classList.contains('active')) {
    header.classList.add('active');
    container.style.maxHeight = container.scrollHeight + "px";
  } else {
    // If it's already open, just update its height to fit the new content
    container.style.maxHeight = container.scrollHeight + "px";
  }
});

document.getElementById('closeEkgModal').addEventListener('click', () => {
  document.getElementById('ekgModal').classList.remove('visible');
});
