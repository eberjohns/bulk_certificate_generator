// 1. INITIAL SETUP
// ----------------
const canvas = new fabric.Canvas('c');
let excelData = []; // To store the rows from the uploaded Excel
let headers = [];   // To store the column names (Name, Date, etc.)

// 2. HANDLE TEMPLATE IMAGE UPLOAD (UPDATED FOR RESPONSIVENESS)
// -------------------------------
document.getElementById('templateUpload').addEventListener('change', function(e) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const imgObj = new Image();
        imgObj.src = event.target.result;
        
        imgObj.onload = function() {
            // 1. Create Fabric image instance
            const imgInstance = new fabric.Image(imgObj);
            
            // 2. Set the "Internal" resolution (High Quality)
            // This ensures the final output is crisp 
            canvas.setWidth(imgInstance.width);
            canvas.setHeight(imgInstance.height);
            
            // 3. Set the background
            canvas.setBackgroundImage(imgInstance, canvas.renderAll.bind(canvas));
            
            // 4. "Fit to Screen" Logic
            fitCanvasToScreen(imgInstance.width, imgInstance.height);

            drawGrid();
        }
    }
    reader.readAsDataURL(e.target.files[0]);
});

// Helper Function: Scale the view without losing quality
function fitCanvasToScreen(originalWidth, originalHeight) {
    // Get the size of the grey area on the right
    const mainArea = document.querySelector('.main-area');
    const padding = 60; // Leave some breathing room
    
    const availableWidth = mainArea.clientWidth - padding;
    const availableHeight = mainArea.clientHeight - padding;
    
    // Calculate scale ratio (which side is the limiting factor?)
    const scale = Math.min(
        availableWidth / originalWidth,
        availableHeight / originalHeight
    );
    
    // If image is smaller than screen, don't scale up (use scale 1)
    // If image is huge, scale down (use scale < 1)
    const finalScale = scale < 1 ? scale : 1;
    
    // 5. Apply CSS Scaling
    // We target the ".canvas-container" div that Fabric creates around our canvas
    const canvasContainer = document.querySelector('.canvas-container');
    const upperCanvas = document.querySelector('.upper-canvas');
    const lowerCanvas = document.querySelector('.lower-canvas');

    // Calculate the display size
    const displayWidth = originalWidth * finalScale;
    const displayHeight = originalHeight * finalScale;

    // Apply styles to force the browser to show it smaller
    // Fabric.js will automatically map the mouse coordinates!
    canvasContainer.style.width = `${displayWidth}px`;
    canvasContainer.style.height = `${displayHeight}px`;

    // Note: Fabric uses two canvases (upper and lower), we must size both
    upperCanvas.style.width = `${displayWidth}px`;
    upperCanvas.style.height = `${displayHeight}px`;
    lowerCanvas.style.width = `${displayWidth}px`;
    lowerCanvas.style.height = `${displayHeight}px`;
    
    canvas.renderAll();
}

// Optional: Re-fit if user resizes the window
window.addEventListener('resize', () => {
    if(canvas.backgroundImage) {
        fitCanvasToScreen(canvas.width, canvas.height);
    }
});

// 3. HANDLE DATA (EXCEL/CSV) UPLOAD
// ---------------------------------
document.getElementById('dataUpload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = function(event) {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        
        // Get first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        excelData = XLSX.utils.sheet_to_json(worksheet);
        
        if(excelData.length > 0) {
            // Extract headers from the first row
            headers = Object.keys(excelData[0]);
            generateFieldButtons(headers);
            
            // Show the "Add Fields" section
            document.getElementById('field-controls').style.display = 'block';
        }
    };
    reader.readAsArrayBuffer(file);
});

// 4. GENERATE BUTTONS FOR HEADERS
// -------------------------------
function generateFieldButtons(headersList) {
    const container = document.getElementById('buttons-container');
    container.innerHTML = ''; // Clear previous buttons
    
    headersList.forEach(header => {
        const btn = document.createElement('button');
        btn.innerText = `+ {${header}}`;
        btn.className = 'field-btn';
        
        // When clicked, add text to canvas
        btn.onclick = () => addTextToCanvas(header);
        
        container.appendChild(btn);
    });
}

// 5. ADD DRAGGABLE TEXT TO CANVAS (FIXED)
// -------------------------------
function addTextToCanvas(headerName) {
    if (!canvas) return;

    const center = canvas.getCenter();
    
    // Offset slightly so multiple clicks don't stack perfectly
    // We use a random offset between -20 and 20 pixels
    const offset = (Math.random() * 40) - 20;

    const text = new fabric.Text(`{${headerName}}`, {
        left: center.left + offset, 
        top: center.top + offset,
        fontFamily: 'Arial',
        fontSize: 40,
        fill: '#000000',
        originX: 'center', 
        originY: 'center', 
        textAlign: 'center',
        id: headerName 
    });
    
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
}

// 6. GENERATE & ZIP (THE MAGIC LOOP)
// ----------------------------------
document.getElementById('generateBtn').addEventListener('click', async function() {
    
    if(excelData.length === 0) {
        alert("Please upload an Excel file first.");
        return;
    }

    const statusDiv = document.getElementById('status-message');
    statusDiv.innerText = "Processing...";
    
    // --- CRITICAL FIX START ---
    
    // 1. DESELECT EVERYTHING
    // This removes the blue box, handles, and rotation controls
    canvas.discardActiveObject();
    
    // 2. HIDE GRID TEMPORARILY
    // We force the grid to be invisible regardless of the button state
    toggleGridVisibility(false);
    
    // 3. RENDER CLEAN STATE
    canvas.renderAll();
    
    // --- CRITICAL FIX END ---

    const zip = new JSZip();
    
    // Loop through rows
    for (let i = 0; i < excelData.length; i++) {
        const row = excelData[i];
        
        updateCanvasWithRowData(row);
        canvas.renderAll(); // Render the clean canvas with new text
        
        const blob = await getCanvasBlob();
        const fileNameSafe = String(Object.values(row)[0]).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        zip.file(`${fileNameSafe}_certificate.png`, blob);
        
        statusDiv.innerText = `Generated ${i + 1} of ${excelData.length}...`;
    }
    
    // RESTORE STATE
    // If grid was originally on, turn it back on
    if(isGridEnabled) {
        toggleGridVisibility(true);
        canvas.renderAll();
    }
    
    // Download
    statusDiv.innerText = "Zipping...";
    zip.generateAsync({type:"blob"}).then(function(content) {
        saveAs(content, "certificates.zip");
        statusDiv.innerText = "Done!";
    });
});

// Helper: Update canvas text based on data row
function updateCanvasWithRowData(row) {
    const objects = canvas.getObjects();
    
    objects.forEach(obj => {
        if (obj.type === 'text' && obj.id) {
            const newText = String(row[obj.id] || '');
            
            // 1. Set the new text
            obj.set({ text: newText });
            
            // 2. Recenter the text block
            // Because we set originX: 'center', simply setting the text
            // automatically expands it to the left and right equally!
            
            // However, sometimes it helps to force a width check if you have wrapping
            // For single lines, the above is usually enough.
        }
    });
}

// Helper: Convert Canvas to Blob (Promise wrapper)
function getCanvasBlob() {
    return new Promise(resolve => {
        canvas.getElement().toBlob(function(blob) {
            resolve(blob);
        });
    });
}

// 7. PREVIEW FUNCTIONALITY
// ------------------------
document.getElementById('previewBtn').addEventListener('click', function() {
    if(excelData.length > 0) {
        updateCanvasWithRowData(excelData[0]); // Show first row data
        canvas.renderAll();
    } else {
        alert("Upload data to preview.");
    }
});

// --- GRID & CENTER SNAPPING ---

const gridSize = 40; // The size of the snap blocks (pixels)
const snapThreshold = 15; // How close to center before snapping to center
let isGridEnabled = true; // Default state

// --- 1. TOGGLE BUTTON LOGIC ---
document.getElementById('toggleGridBtn').addEventListener('click', function() {
    isGridEnabled = !isGridEnabled;
    
    // Update Button Text
    this.innerText = isGridEnabled ? "Grid: ON" : "Grid: OFF";
    this.style.background = isGridEnabled ? "#555" : "#ccc";
    
    // Show/Hide Lines
    toggleGridVisibility(isGridEnabled);
    canvas.renderAll();
});

// Helper: Show or Hide Grid Lines
function toggleGridVisibility(visible) {
    const objects = canvas.getObjects();
    objects.forEach(obj => {
        if (obj.id === 'grid-line') {
            obj.set('visible', visible);
        }
    });
}

// 1. DRAW THE GRID (Visual Aid)
function drawGrid() {
    // Remove old grid if exists
    const objects = canvas.getObjects();
    for (let i = objects.length - 1; i >= 0; i--) {
        if (objects[i].id === 'grid-line') {
            canvas.remove(objects[i]);
        }
    }

    // Draw Vertical Lines
    for (let i = 0; i < (canvas.width / gridSize); i++) {
        const line = new fabric.Line([i * gridSize, 0, i * gridSize, canvas.height], {
            stroke: '#ccc',
            selectable: false,
            evented: false,
            id: 'grid-line',
            opacity: 0.5
        });
        canvas.sendToBack(line); // Send behind text
        canvas.add(line);
    }

    // Draw Horizontal Lines
    for (let i = 0; i < (canvas.height / gridSize); i++) {
        const line = new fabric.Line([0, i * gridSize, canvas.width, i * gridSize], {
            stroke: '#ccc',
            selectable: false,
            evented: false,
            id: 'grid-line',
            opacity: 0.5
        });
        canvas.sendToBack(line);
        canvas.add(line);
    }
    
    // Draw Center Line (Red)
    const centerLine = new fabric.Line([canvas.width / 2, 0, canvas.width / 2, canvas.height], {
        stroke: 'red',
        strokeWidth: 2,
        selectable: false,
        evented: false,
        id: 'grid-line',
        opacity: 0.8
    });
    canvas.add(centerLine);
}

// 2. UPDATED SNAPPING LOGIC
canvas.on('object:moving', function(options) {
    // IF GRID IS OFF: Do nothing (standard smooth dragging)
    if (!isGridEnabled) return;

    const target = options.target;
    const canvasWidth = canvas.width;
    
    const objectCenter = target.left + (target.width * target.scaleX) / 2;
    
    // A. CENTER SNAP (Always active if Grid is On)
    if (Math.abs(objectCenter - canvasWidth / 2) < snapThreshold) {
        target.set({
            left: (canvasWidth / 2) - (target.width * target.scaleX) / 2,
            top: Math.round(target.top / gridSize) * gridSize
        });
    } 
    // B. GRID SNAP
    else {
        target.set({
            left: Math.round(target.left / gridSize) * gridSize,
            top: Math.round(target.top / gridSize) * gridSize
        });
    }
});

// 3. TRIGGER GRID ON IMAGE LOAD
// We need to redraw grid whenever the image changes/resizes
// Find your 'templateUpload' listener and add `drawGrid()` at the end of it.