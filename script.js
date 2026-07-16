// 1. INITIAL CONFIG
const canvas = new fabric.Canvas('c', {
    selection: false,
    preserveObjectStacking: true,
    allowTouchScrolling: false
});

let excelData = [];
let headers = [];
let isGridEnabled = false;
const gridSize = 40;
let generatedCertificates = []; // Cache for email dispatch

// IndexedDB Helper Functions
const dbName = "SmartCertGeneratorDB";
const storeName = "AppStateStore";

function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(request.error);
    });
}

async function dbSet(key, val) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            const request = store.put(val, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error("IndexedDB error:", err);
    }
}

async function dbGet(key) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error("IndexedDB error:", err);
        return null;
    }
}

// 2. RESIZE HANDLER
function resizeCanvasElement() {
    const wrapper = document.querySelector('.canvas-wrapper');
    if(wrapper) {
        canvas.setWidth(wrapper.clientWidth);
        canvas.setHeight(wrapper.clientHeight);
        if (canvas.backgroundImage) {
            fitImageToScreen(canvas.backgroundImage.width, canvas.backgroundImage.height);
        }
    }
}
window.addEventListener('resize', resizeCanvasElement);
resizeCanvasElement(); 

function updateDropzoneUi(dropzoneId, icon, text) {
    const dropzone = document.getElementById(dropzoneId);
    if (!dropzone) return;
    const iconEl = dropzone.querySelector('.dropzone-icon');
    const textEl = dropzone.querySelector('.dropzone-text');
    if (iconEl) iconEl.innerHTML = icon;
    if (textEl) textEl.innerHTML = text;
}

// 3. IMAGE UPLOAD
document.getElementById('templateUpload').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    await dbSet('templateImage', file);
    await dbSet('templateFileName', file.name);
    loadTemplateFromFile(file);
    updateDropzoneUi('templateDropzone', '🖼️', `Selected: <strong style="color: var(--primary); word-break: break-all;">${file.name}</strong><br><span style="font-size: 0.7rem; color: var(--success); font-weight: 600;">✓ Background Loaded</span>`);
});

function loadTemplateFromFile(file) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const imgObj = new Image();
        imgObj.src = event.target.result;
        imgObj.onload = function() {
            canvas.clear();
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

            const imgInstance = new fabric.Image(imgObj, {
                selectable: false, evented: false, originX: 'left', originY: 'top'
            });

            canvas.setBackgroundImage(imgInstance, canvas.renderAll.bind(canvas));
            fitImageToScreen(imgInstance.width, imgInstance.height);
            syncGridState();
            
            // Clear layers list on new template
            updateLayerList();
            saveCanvasObjects();
        }
    }
    reader.readAsDataURL(file);
}

function fitImageToScreen(imgW, imgH) {
    if (!imgW || !imgH) return;
    const canvasW = canvas.getWidth();
    const canvasH = canvas.getHeight();
    const padding = 20;
    
    const scale = Math.min((canvasW - padding) / imgW, (canvasH - padding) / imgH);
    const panX = (canvasW - imgW * scale) / 2;
    const panY = (canvasH - imgH * scale) / 2;

    canvas.setViewportTransform([scale, 0, 0, scale, panX, panY]);
    canvas.renderAll();
}

// 4. TOUCH & MOUSE LOGIC
let isDragging = false;
let isMouseDown = false;
let lastPosX, lastPosY;
let dragStartPosX, dragStartPosY;

canvas.on('mouse:down', function(opt) {
    if (opt.target) { isDragging = false; isMouseDown = false; return; }
    isMouseDown = true; isDragging = false;
    
    const evt = opt.e;
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    
    lastPosX = clientX; lastPosY = clientY;
    dragStartPosX = clientX; dragStartPosY = clientY;
});

canvas.on('mouse:move', function(opt) {
    if (!isMouseDown) return;
    const evt = opt.e;
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;

    if (!isDragging) {
        const dist = Math.sqrt(Math.pow(clientX - dragStartPosX, 2) + Math.pow(clientY - dragStartPosY, 2));
        if (dist < 10) return; 
        isDragging = true;
    }

    const vpt = this.viewportTransform;
    vpt[4] += clientX - lastPosX;
    vpt[5] += clientY - lastPosY;
    this.requestRenderAll();
    lastPosX = clientX; lastPosY = clientY;
});

canvas.on('mouse:up', function() { isMouseDown = false; isDragging = false; });

canvas.on('mouse:wheel', function(opt) {
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom();
    zoom *= 0.999 ** delta;
    if (zoom > 5) zoom = 5; if (zoom < 0.1) zoom = 0.1;
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    opt.e.preventDefault(); opt.e.stopPropagation();
});

// 5. SNAPPING
canvas.on('object:moving', function(options) {
    if (!isGridEnabled) return;
    const target = options.target;
    target.set({
        left: Math.round(target.left / gridSize) * gridSize,
        top: Math.round(target.top / gridSize) * gridSize
    });
});

// 6. ADD TEXT & LAYERS
function generateQrDataUrl(value) {
    try {
        const qr = new QRious({
            value: value || ' ',
            size: 300
        });
        return qr.toDataURL();
    } catch (err) {
        console.error("QR Code generation failed for value:", value, err);
        // Fallback to a 1x1 transparent pixel data URL
        return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }
}

function addTextToCanvas(headerName) {
    if (!canvas.backgroundImage) { alert("Upload template first"); return; }
    
    const vpt = canvas.viewportTransform;
    const centerX = (-vpt[4] + canvas.getWidth() / 2) / vpt[0];
    const centerY = (-vpt[5] + canvas.getHeight() / 2) / vpt[3];

    const text = new fabric.Text(`{${headerName}}`, {
        left: centerX, top: centerY,
        fontFamily: 'Arial', fontSize: 40 / canvas.getZoom(),
        fill: '#000000', originX: 'center', originY: 'center', textAlign: 'center',
        id: headerName
    });
    
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    updateLayerList();
}

function addQrcodeToCanvas(headerName) {
    if (!canvas.backgroundImage) { alert("Upload template first"); return; }
    
    const vpt = canvas.viewportTransform;
    const centerX = (-vpt[4] + canvas.getWidth() / 2) / vpt[0];
    const centerY = (-vpt[5] + canvas.getHeight() / 2) / vpt[3];

    const qrImg = new Image();
    qrImg.onload = function() {
        const fabricImg = new fabric.Image(qrImg, {
            left: centerX, top: centerY,
            originX: 'center', originY: 'center',
            id: 'qr-' + headerName,
            isQrCode: true,
            columnHeader: headerName
        });
        
        fabricImg.scaleToWidth(150 / canvas.getZoom());
        canvas.add(fabricImg);
        canvas.setActiveObject(fabricImg);
        canvas.renderAll();
        updateLayerList();
    };
    qrImg.src = generateQrDataUrl(`{QR:${headerName}}`);
}

function updateLayerList() {
    const container = document.getElementById('layers-container');
    const panel = document.getElementById('layers-panel');
    container.innerHTML = '';
    
    const objects = canvas.getObjects().filter(o => (o.type === 'text' && o.id) || o.isQrCode);
    panel.style.display = objects.length > 0 ? 'block' : 'none';

    const activeObj = canvas.getActiveObject();

    objects.forEach(obj => {
        const btn = document.createElement('button');
        btn.innerText = obj.isQrCode ? `QR Code: {${obj.columnHeader}}` : obj.text;
        btn.style.padding = '8px'; btn.style.textAlign = 'left';
        btn.style.border = '1px solid #ccc'; btn.style.background = 'white';
        btn.style.borderRadius = '4px'; btn.style.cursor = 'pointer';

        if (activeObj === obj) {
            btn.style.background = '#e7f1ff';
            btn.style.borderColor = '#007bff';
            btn.style.color = '#007bff';
            btn.style.fontWeight = 'bold';
        }

        btn.onclick = () => {
            canvas.setActiveObject(obj);
            canvas.renderAll();
            document.getElementById('properties-panel').scrollIntoView({behavior: "smooth"});
        };
        container.appendChild(btn);
    });
}

// 7. GRID
function drawGrid() {
    canvas.getObjects().forEach(o => { if(o.id === 'grid-line') canvas.remove(o) });
    if (!isGridEnabled || !canvas.backgroundImage) return;

    const width = canvas.backgroundImage.width;
    const height = canvas.backgroundImage.height;

    for (let i = 0; i < (width / gridSize); i++) {
        const line = new fabric.Line([i * gridSize, 0, i * gridSize, height], { stroke: '#000', strokeWidth: 1, selectable: false, evented: false, id: 'grid-line', opacity: 0.2 });
        canvas.add(line); line.sendToBack();
    }
    for (let i = 0; i < (height / gridSize); i++) {
        const line = new fabric.Line([0, i * gridSize, width, i * gridSize], { stroke: '#000', strokeWidth: 1, selectable: false, evented: false, id: 'grid-line', opacity: 0.2 });
        canvas.add(line); line.sendToBack();
    }
    if(canvas.backgroundImage) canvas.backgroundImage.sendToBack();
}
const gridCheckbox = document.getElementById('gridToggle');
function syncGridState() { isGridEnabled = gridCheckbox.checked; drawGrid(); }
gridCheckbox.addEventListener('change', syncGridState);


// 8. DATA UPLOAD
document.getElementById('dataUpload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(event) {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const parsed = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        if(parsed.length > 0) {
            await dbSet('excelData', parsed);
            await dbSet('excelFileName', file.name);
            handleSpreadsheetData(parsed);
            updateDropzoneUi('dataDropzone', '📄', `Selected: <strong style="color: var(--primary); word-break: break-all;">${file.name}</strong><br><span style="font-size: 0.7rem; color: var(--success); font-weight: 600;">✓ Data Parsed Successfully</span>`);
        }
    };
    reader.readAsArrayBuffer(file);
});

async function handleSpreadsheetData(data) {
    excelData = data;
    if(excelData.length > 0) {
        headers = Object.keys(excelData[0]);
        generateFieldButtons(headers);
        populateQrDropdown();
        populateEmailDropdown();
        
        // Reapply saved values if they exist
        if (window.savedQrCol) {
            const qrSel = document.getElementById('qrcodeColumnSelect');
            if (qrSel) qrSel.value = window.savedQrCol;
        }
        if (window.savedEmailCol) {
            const emailSel = document.getElementById('emailColumnSelect');
            if (emailSel) emailSel.value = window.savedEmailCol;
        }
        
        document.getElementById('field-controls').style.display = 'block';
    }
}

function generateFieldButtons(list) {
    const container = document.getElementById('buttons-container');
    container.innerHTML = '';
    list.forEach(h => {
        const btn = document.createElement('button');
        btn.innerText = `+ {${h}}`;
        btn.className = 'field-btn';
        btn.onclick = () => addTextToCanvas(h);
        container.appendChild(btn);
    });
}

// QR Code Generator UI events and helpers
function populateQrDropdown() {
    const select = document.getElementById('qrcodeColumnSelect');
    if (!select) return;
    select.innerHTML = '';
    headers.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        select.appendChild(opt);
    });
}

document.getElementById('qrcodeToggle').addEventListener('change', function() {
    const fieldsDiv = document.getElementById('qrcode-fields');
    if (this.checked) {
        fieldsDiv.style.display = 'block';
        populateQrDropdown();
    } else {
        fieldsDiv.style.display = 'none';
    }
});

function addSelectedQrcode() {
    const select = document.getElementById('qrcodeColumnSelect');
    if (select && select.value) {
        addQrcodeToCanvas(select.value);
    } else {
        alert("Please upload Data file first and select a column.");
    }
}

document.getElementById('addQrcodeColBtn').addEventListener('click', addSelectedQrcode);
document.getElementById('addQrcodeBtn').addEventListener('click', addSelectedQrcode);

// Step Card click toggle handlers
document.getElementById('tools-box').addEventListener('click', function(e) {
    if (e.target !== document.getElementById('gridToggle') && e.target.tagName !== 'LABEL') {
        const cb = document.getElementById('gridToggle');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
    }
});

document.getElementById('qrcode-box').addEventListener('click', function(e) {
    const ignoredTags = ['SELECT', 'BUTTON', 'INPUT', 'LABEL', 'OPTION'];
    if (!ignoredTags.includes(e.target.tagName)) {
        const cb = document.getElementById('qrcodeToggle');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
    }
});

// 9. PROPERTIES & LOGIC
const propPanel = document.getElementById('properties-panel');

function changeAlignment(activeObj, alignment) {
    if (!activeObj) return;
    const centerPoint = activeObj.getCenterPoint();
    activeObj.set({
        originX: alignment,
        textAlign: alignment
    });
    activeObj.setPositionByOrigin(centerPoint, alignment, activeObj.originY || 'center');
    canvas.requestRenderAll();
}

function updatePanel() {
    const active = canvas.getActiveObject();
    if (!active) {
        propPanel.style.display = 'none';
        return;
    }
    
    propPanel.style.display = 'block';
    
    if (active.type === 'text') {
        document.getElementById('propertiesTitle').innerText = "Edit Text Field";
        document.getElementById('textProperties').style.display = 'block';
        document.getElementById('qrcodeProperties').style.display = 'none';
        
        document.getElementById('fontFamilyBtn').value = active.fontFamily || 'Arial';
        document.getElementById('fontSizeBtn').value = active.fontSize || 40;
        document.getElementById('fontColorBtn').value = active.fill || '#000000';
        document.getElementById('alignmentBtn').value = active.originX || 'center';
    } else if (active.isQrCode) {
        document.getElementById('propertiesTitle').innerText = "Edit QR Code";
        document.getElementById('textProperties').style.display = 'none';
        document.getElementById('qrcodeProperties').style.display = 'block';
        document.getElementById('qrcodeSourceDisplay').value = active.columnHeader || '';
    } else {
        propPanel.style.display = 'none';
        return;
    }

    // Automatically scroll the sidebar to show the properties panel
    setTimeout(() => {
        propPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
}
canvas.on('selection:created', () => { updatePanel(); updateLayerList(); });
canvas.on('selection:updated', () => { updatePanel(); updateLayerList(); });
canvas.on('selection:cleared', () => { updatePanel(); updateLayerList(); });

document.getElementById('fontFamilyBtn').addEventListener('change', function() { if(canvas.getActiveObject()) { canvas.getActiveObject().set('fontFamily', this.value); canvas.requestRenderAll(); saveCanvasObjects(); }});
document.getElementById('fontSizeBtn').addEventListener('input', function() { if(canvas.getActiveObject()) { canvas.getActiveObject().set('fontSize', parseInt(this.value)); canvas.requestRenderAll(); saveCanvasObjects(); }});
document.getElementById('fontColorBtn').addEventListener('input', function() { if(canvas.getActiveObject()) { canvas.getActiveObject().set('fill', this.value); canvas.requestRenderAll(); saveCanvasObjects(); }});
document.getElementById('alignmentBtn').addEventListener('change', function() { if(canvas.getActiveObject() && canvas.getActiveObject().type === 'text') { changeAlignment(canvas.getActiveObject(), this.value); saveCanvasObjects(); }});
document.getElementById('deleteBtn').addEventListener('click', () => { 
    canvas.remove(canvas.getActiveObject()); canvas.discardActiveObject(); canvas.renderAll(); updateLayerList(); saveCanvasObjects();
});

// 10. PREVIEW ROW
document.getElementById('previewBtn').addEventListener('click', function() {
    if(excelData.length > 0) {
        const row = excelData[0];
        const updatePromises = [];
        
        canvas.getObjects().forEach(obj => {
            if (obj.type === 'text' && obj.id) {
                const newData = row[obj.id] !== undefined ? String(row[obj.id]) : '';
                obj.set({ text: newData });
            } else if (obj.isQrCode && obj.columnHeader) {
                const value = row[obj.columnHeader] !== undefined ? String(row[obj.columnHeader]) : '';
                const promise = new Promise((resolve) => {
                    const tempImg = new Image();
                    tempImg.onload = function() {
                        obj.setElement(tempImg);
                        resolve();
                    };
                    tempImg.src = generateQrDataUrl(value);
                });
                updatePromises.push(promise);
            }
        });
        
        Promise.all(updatePromises).then(() => {
            canvas.renderAll();
            updateLayerList();
        });
    } else {
        alert("Please upload Data file first.");
    }
});

// 11. GENERATE
document.getElementById('generateBtn').addEventListener('click', async function() {
    if(excelData.length === 0) { alert("Upload Data First"); return; }
    
    const generateBtn = document.getElementById('generateBtn');
    const previewBtn = document.getElementById('previewBtn');
    const statusDiv = document.getElementById('status-message');
    
    // Disable buttons to prevent duplicate triggers
    generateBtn.disabled = true;
    previewBtn.disabled = true;
    generateBtn.style.opacity = '0.7';
    previewBtn.style.opacity = '0.7';
    
    statusDiv.innerText = "Initializing generation...";
    
    try {
        canvas.discardActiveObject();
        const wasGrid = isGridEnabled; isGridEnabled=false; drawGrid(); canvas.renderAll();
        
        const originalVpt = canvas.viewportTransform.slice();
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.setWidth(canvas.backgroundImage.width);
        canvas.setHeight(canvas.backgroundImage.height);
        
        const zip = new JSZip();
        const pattern = document.getElementById('fileNamePattern').value.trim() || `{${headers[0]}}_Certificate`;
        generatedCertificates = []; // reset cached images
        
        for (let i = 0; i < excelData.length; i++) {
            statusDiv.innerText = `Generating (${i + 1}/${excelData.length})...`;
            const row = excelData[i];
            
            // Allow renderer to flush status string to UI
            await new Promise(r => setTimeout(r, 0));
            
            canvas.getObjects().forEach(o => { if(o.type==='text' && o.id) o.set('text', String(row[o.id]||'')) });
            
            // Update QR code layers for each row
            const qrPromises = [];
            canvas.getObjects().forEach(o => {
                if (o.isQrCode && o.columnHeader) {
                    const val = String(row[o.columnHeader] !== undefined ? row[o.columnHeader] : '');
                    const p = new Promise(resolve => {
                        const tempImg = new Image();
                        tempImg.onload = function() {
                            o.setElement(tempImg);
                            resolve();
                        };
                        tempImg.src = generateQrDataUrl(val);
                    });
                    qrPromises.push(p);
                }
            });
            
            if (qrPromises.length > 0) {
                await Promise.all(qrPromises);
            }
            
            canvas.renderAll();
            
            const blob = await new Promise(r => canvas.getElement().toBlob(r));
            let fname = pattern;
            headers.forEach(h => fname = fname.replace(new RegExp(`{${h}}`, 'gi'), row[h]||''));
            const sanitizedFname = fname.replace(/[^a-z0-9 \-_]/gi, '_');
            zip.file(`${sanitizedFname}.png`, blob);
            
            // Save for email attachments
            generatedCertificates.push({
                row: row,
                fileName: sanitizedFname,
                dataUrl: canvas.toDataURL({format: 'png', quality: 1.0})
            });
        }
        
        resizeCanvasElement();
        canvas.setViewportTransform(originalVpt);
        if(wasGrid) { isGridEnabled=true; drawGrid(); }
        
        statusDiv.innerText = "Packaging files...";
        const zipBlob = await zip.generateAsync({type:"blob"});
        saveAs(zipBlob, "certificates.zip");
        statusDiv.innerText = "Done!";
        
        // Show the Email Box!
        const emailBox = document.getElementById('email-box');
        if (emailBox) {
            emailBox.style.display = 'block';
            populateEmailDropdown();
            setTimeout(() => {
                emailBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }, 200);
        }
    } catch (err) {
        console.error("Batch generation failed:", err);
        statusDiv.innerText = "Generation failed. Check console.";
    } finally {
        // Restore buttons
        generateBtn.disabled = false;
        previewBtn.disabled = false;
        generateBtn.style.opacity = '1';
        previewBtn.style.opacity = '1';
    }
});

// Zoom Helpers
window.zoomCanvas = (factor) => {
    let zoom = canvas.getZoom() * factor;
    if(zoom>5) zoom=5; if(zoom<0.1) zoom=0.1;
    canvas.setZoom(zoom);
    canvas.renderAll();
};
window.resetZoom = () => {
    if(canvas.backgroundImage) fitImageToScreen(canvas.backgroundImage.width, canvas.backgroundImage.height);
};

// Drag & Drop Setup
function setupDragAndDrop(dropzoneId, inputId) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    if (!dropzone || !input) return;
    
    dropzone.addEventListener('click', () => input.click());
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    
    ['dragleave', 'dragend'].forEach(evt => {
        dropzone.addEventListener(evt, () => {
            dropzone.classList.remove('dragover');
        });
    });
    
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            input.files = e.dataTransfer.files;
            input.dispatchEvent(new Event('change'));
        }
    });
}

setupDragAndDrop('dataDropzone', 'dataUpload');
setupDragAndDrop('templateDropzone', 'templateUpload');

// Email Column Selector
function populateEmailDropdown() {
    const select = document.getElementById('emailColumnSelect');
    if (!select) return;
    select.innerHTML = '';
    headers.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        if (h.toLowerCase() === 'email' || h.toLowerCase() === 'mail') {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

// Google OAuth & Gmail API variables
let tokenClient;
let accessToken = null;
let userEmail = '';

// Initialize Google OAuth Token Client
window.initGoogleAuth = () => {
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: '972249221035-787q8a3ijndkr71d5c42alj0jbca81b1.apps.googleusercontent.com',
            scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
            callback: async (response) => {
                if (response.error !== undefined) {
                    console.error("Google Auth Error:", response.error);
                    alert("Authentication failed: " + response.error);
                    return;
                }
                accessToken = response.access_token;
                
                // Fetch connected email address
                try {
                    const infoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    const userInfo = await infoResp.json();
                    userEmail = userInfo.email;
                    
                    document.getElementById('google-connected-email').innerText = `Connected as: ${userEmail}`;
                    document.getElementById('google-auth-btn').style.display = 'none';
                    document.getElementById('google-connected-area').style.display = 'block';
                } catch (err) {
                    console.error("Failed to fetch user email:", err);
                    alert("Failed to retrieve connected email address. You can still proceed to send.");
                }
            },
        });
    } catch (err) {
        console.error("Google Client SDK init failed:", err);
    }
};

// Auth trigger buttons
document.getElementById('google-auth-btn').addEventListener('click', () => {
    if (tokenClient) {
        // Request token (triggers browser popup)
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert("Google Authentication SDK is still loading. Please wait a second and try again.");
    }
});

document.getElementById('google-logout-btn').addEventListener('click', (e) => {
    e.preventDefault();
    if (accessToken) {
        google.accounts.oauth2.revokeToken(accessToken, () => {
            accessToken = null;
            userEmail = '';
            document.getElementById('google-connected-area').style.display = 'none';
            document.getElementById('google-auth-btn').style.display = 'block';
        });
    }
});

// Helper: Build RFC 822 MIME message with a PNG attachment
function buildMimeMessage(senderEmail, senderName, to, subject, body, base64Png, fileName) {
    const boundary = "boundary_" + Math.random().toString(36).substring(2);
    const fromHeader = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
    
    const parts = [
        `From: ${fromHeader}`,
        `To: ${to}`,
        `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        body,
        ``,
        `--${boundary}`,
        `Content-Type: image/png; name="${fileName}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${fileName}"`,
        ``,
        base64Png,
        ``,
        `--${boundary}--`
    ];
    
    return parts.join("\r\n");
}

// Helper: Convert string to base64url format (replace + with -, / with _, remove trailing =)
function base64urlEncode(str) {
    const base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Send Bulk Emails via Gmail REST API
document.getElementById('sendEmailsBtn').addEventListener('click', async function() {
    if (!accessToken) {
        alert("Please connect your Google Account first.");
        return;
    }
    if (generatedCertificates.length === 0) {
        alert("Please generate certificates first.");
        return;
    }
    
    const emailCol = document.getElementById('emailColumnSelect').value;
    const senderName = document.getElementById('emailSenderName').value.trim();
    const subjectPattern = document.getElementById('emailSubject').value.trim() || "Your Certificate";
    const bodyPattern = document.getElementById('emailBody').value;
    
    const emailStatus = document.getElementById('email-status-message');
    const sendBtn = document.getElementById('sendEmailsBtn');
    
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.7';
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < generatedCertificates.length; i++) {
        const cert = generatedCertificates[i];
        const row = cert.row;
        const recipient = String(row[emailCol] || '').trim();
        
        if (!recipient) {
            console.warn(`Skipping index ${i}: No email address found in column '${emailCol}'`);
            failCount++;
            continue;
        }
        
        emailStatus.innerText = `Sending email (${i + 1}/${generatedCertificates.length}) to ${recipient}...`;
        
        // Customize subject/body using row placeholders
        let subject = subjectPattern;
        let body = bodyPattern;
        headers.forEach(h => {
            const regex = new RegExp(`{${h}}`, 'gi');
            subject = subject.replace(regex, String(row[h] || ''));
            body = body.replace(regex, String(row[h] || ''));
        });
        
        const rawBase64 = cert.dataUrl.split(',')[1];
        const mimeMsg = buildMimeMessage(userEmail, senderName, recipient, subject, body, rawBase64, `${cert.fileName}.png`);
        const base64UrlMsg = base64urlEncode(mimeMsg);
        
        try {
            const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    raw: base64UrlMsg
                })
            });
            
            if (response.ok) {
                successCount++;
            } else {
                const errData = await response.json();
                throw new Error(errData.error?.message || "Unknown Gmail API error");
            }
        } catch (err) {
            console.error(`Failed to send email to ${recipient}:`, err);
            failCount++;
        }
        
        // Wait 800ms between sends to avoid spam thresholds
        await new Promise(r => setTimeout(r, 800));
    }
    
    emailStatus.innerText = `Completed! Sent: ${successCount}, Failed: ${failCount}`;
    sendBtn.disabled = false;
    sendBtn.style.opacity = '1';
});

// Poll to check when Google SDK is loaded, then initialize
function checkGoogleSdk() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        initGoogleAuth();
    } else {
        setTimeout(checkGoogleSdk, 100);
    }
}
checkGoogleSdk();

// Workspace State Persistence Logic
function saveCanvasObjects() {
    if (!canvas) return;
    const objectsJson = canvas.getObjects().map(o => o.toJSON(['id', 'isQrCode', 'columnHeader']));
    dbSet('canvasObjects', objectsJson);
}

function saveFormState() {
    const state = {
        fileNamePattern: document.getElementById('fileNamePattern').value,
        emailSubject: document.getElementById('emailSubject').value,
        emailBody: document.getElementById('emailBody').value,
        emailSenderName: document.getElementById('emailSenderName').value,
        gridToggle: document.getElementById('gridToggle').checked,
        qrcodeToggle: document.getElementById('qrcodeToggle').checked,
        qrcodeColumnSelect: document.getElementById('qrcodeColumnSelect')?.value || '',
        emailColumnSelect: document.getElementById('emailColumnSelect')?.value || ''
    };
    localStorage.setItem('cert_generator_form_state', JSON.stringify(state));
}

// Attach listeners to save configurations dynamically
['fileNamePattern', 'emailSubject', 'emailBody', 'emailSenderName', 'gridToggle', 'qrcodeToggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', saveFormState);
        el.addEventListener('change', saveFormState);
    }
});

// Trigger form state save on dynamic select changes
document.addEventListener('change', (e) => {
    if (e.target && (e.target.id === 'qrcodeColumnSelect' || e.target.id === 'emailColumnSelect')) {
        saveFormState();
    }
});

function loadFormState() {
    const raw = localStorage.getItem('cert_generator_form_state');
    if (!raw) return;
    try {
        const state = JSON.parse(raw);
        document.getElementById('fileNamePattern').value = state.fileNamePattern || '';
        document.getElementById('emailSubject').value = state.emailSubject || '';
        document.getElementById('emailBody').value = state.emailBody || '';
        document.getElementById('emailSenderName').value = state.emailSenderName || '';
        
        const gridToggle = document.getElementById('gridToggle');
        gridToggle.checked = !!state.gridToggle;
        syncGridState();
        
        const qrToggle = document.getElementById('qrcodeToggle');
        qrToggle.checked = !!state.qrcodeToggle;
        qrToggle.dispatchEvent(new Event('change'));
        
        window.savedQrCol = state.qrcodeColumnSelect;
        window.savedEmailCol = state.emailColumnSelect;
    } catch (e) {
        console.error("Failed to load form state:", e);
    }
}

async function restoreSavedState() {
    // 1. Load configuration forms
    loadFormState();
    
    // 2. Load spreadsheet data
    const savedData = await dbGet('excelData');
    if (savedData && savedData.length > 0) {
        await handleSpreadsheetData(savedData);
        const savedExcelName = await dbGet('excelFileName');
        if (savedExcelName) {
            updateDropzoneUi('dataDropzone', '📄', `Selected: <strong style="color: var(--primary); word-break: break-all;">${savedExcelName}</strong><br><span style="font-size: 0.7rem; color: var(--success); font-weight: 600;">✓ Data Parsed Successfully</span>`);
        }
    }
    
    // 3. Load template background
    const savedTemplateBlob = await dbGet('templateImage');
    if (savedTemplateBlob) {
        const savedTemplateName = await dbGet('templateFileName');
        if (savedTemplateName) {
            updateDropzoneUi('templateDropzone', '🖼️', `Selected: <strong style="color: var(--primary); word-break: break-all;">${savedTemplateName}</strong><br><span style="font-size: 0.7rem; color: var(--success); font-weight: 600;">✓ Background Loaded</span>`);
        }
        
        const imgUrl = URL.createObjectURL(savedTemplateBlob);
        const imgObj = new Image();
        imgObj.src = imgUrl;
        imgObj.onload = function() {
            canvas.clear();
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            
            const imgInstance = new fabric.Image(imgObj, {
                selectable: false, evented: false, originX: 'left', originY: 'top'
            });
            
            canvas.setBackgroundImage(imgInstance, () => {
                fitImageToScreen(imgInstance.width, imgInstance.height);
                syncGridState();
                
                // 4. Load canvas objects
                restoreCanvasObjects().then(() => {
                    bindCanvasAutoSave();
                });
            });
        };
    } else {
        bindCanvasAutoSave();
    }
}

function restoreCanvasObjects() {
    return new Promise(async (resolve) => {
        const savedObjects = await dbGet('canvasObjects');
        if (savedObjects && savedObjects.length > 0) {
            canvas.getObjects().forEach(o => canvas.remove(o));
            
            fabric.util.enlivenObjects(savedObjects, (enlivenedObjects) => {
                enlivenedObjects.forEach(obj => {
                    canvas.add(obj);
                });
                canvas.renderAll();
                updateLayerList();
                resolve();
            });
        } else {
            resolve();
        }
    });
}

function bindCanvasAutoSave() {
    canvas.on('object:added', saveCanvasObjects);
    canvas.on('object:modified', saveCanvasObjects);
    canvas.on('object:removed', saveCanvasObjects);
    canvas.on('text:changed', saveCanvasObjects);
}

// Reset workspace action
document.getElementById('resetWorkspaceBtn').addEventListener('click', async () => {
    if (confirm("Are you sure you want to clear all template images, data records, and text positions from the workspace?")) {
        localStorage.removeItem('cert_generator_form_state');
        try {
            const db = await getDB();
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).clear();
            await new Promise((r, rej) => {
                tx.oncomplete = () => r();
                tx.onerror = () => rej(tx.error);
            });
        } catch(e) {
            console.error("Failed to clear database:", e);
        }
        location.reload();
    }
});

// Run state recovery on launch
restoreSavedState();

