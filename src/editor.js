const { ipcRenderer } = require('electron'); // clipboardは不要になったので削除
const fabric = require('fabric').fabric;

const canvas = new fabric.Canvas('editor', { isDrawingMode: true });
let currentColor = '#ff4d4d';
let currentTool = 'pen';
let history = [];
let historyProcessing = false;
let bgImageObject = null;

let evidenceCount = 1;
let currentLang = 'ja';

const UI_TEXTS = {
  ja: {
    fileLabel: "ファイル名:", confirmDiscard: "保存せずに破棄しますか？",
    btnSave: "保存して閉じる", ticketPlaceholder: "チケット名", descPlaceholder: "内容",
  },
  en: {
    fileLabel: "Filename:", confirmDiscard: "Discard changes?",
    btnSave: "Save & Close", ticketPlaceholder: "TICKET-ID", descPlaceholder: "Description",
  }
};

const inputPrefix = document.getElementById('input-prefix');
const inputName = document.getElementById('input-name');
const chkSeq = document.getElementById('chk-seq');
const previewLabel = document.getElementById('filename-preview');
const labelFile = document.querySelector('.preview-row span:first-child');
const btnSave = document.getElementById('btn-save');
const btnCopy = document.getElementById('btn-copy');
const btnDiscard = document.getElementById('btn-discard');
const btnWindowClose = document.getElementById('btn-window-close');

inputPrefix.addEventListener('input', updatePreview);
inputName.addEventListener('input', updatePreview);
chkSeq.addEventListener('change', updatePreview);

ipcRenderer.on('set-filename', (event, aiNameRaw) => {
  inputName.value = ""; 
  updatePreview();
});

function updatePreview() {
  const parts = [];
  const prefix = inputPrefix.value.trim();
  if (prefix) parts.push(prefix);
  if (chkSeq.checked) {
    parts.push(String(evidenceCount).padStart(2, '0'));
  }
  const name = inputName.value.trim();
  if (name) parts.push(name);
  
  let finalName = parts.length > 0 ? parts.join('_') : `Screenshot_${getTimestamp()}`;
  finalName += ".png";
  previewLabel.textContent = finalName;
}

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
}

ipcRenderer.on('load-image', (event, data) => {
  const base64Image = data.image;
  currentLang = data.language || 'ja';
  updateUILanguage();

  canvas.clear();
  history = [];
  fabric.Image.fromURL(base64Image, (img) => {
    canvas.setWidth(img.width);
    canvas.setHeight(img.height);
    canvas.setBackgroundImage(img, () => {
      canvas.renderAll();
      bgImageObject = img; 
      saveHistory(); 
    }, { scaleX: 1, scaleY: 1 });
    resetToolState();
  });
});

function updateUILanguage() {
  const t = UI_TEXTS[currentLang];
  if (!t) return;
  labelFile.textContent = t.fileLabel;
  btnSave.textContent = t.btnSave;
  inputPrefix.placeholder = t.ticketPlaceholder;
  inputName.placeholder = t.descPlaceholder;
}

function saveHistory() {
  if (historyProcessing) return;
  if (history.length > 20) history.shift();
  const json = canvas.toObject(); 
  delete json.backgroundImage; 
  history.push(JSON.stringify(json));
}
canvas.on('object:added', saveHistory);
canvas.on('object:modified', saveHistory);
canvas.on('object:removed', saveHistory);

canvas.freeDrawingBrush.color = currentColor;
canvas.freeDrawingBrush.width = 5;

const toolPenBtn = document.getElementById('tool-pen');
const toolRectBtn = document.getElementById('tool-rect');
const toolUndoBtn = document.getElementById('tool-undo');
const toolSettingsBtn = document.getElementById('tool-settings');

toolPenBtn.addEventListener('click', () => setTool('pen'));
toolRectBtn.addEventListener('click', () => setTool('rect'));
toolSettingsBtn.addEventListener('click', () => ipcRenderer.send('open-settings'));

toolUndoBtn.addEventListener('click', () => {
  if (history.length <= 1) return;
  historyProcessing = true;
  history.pop();
  const prevState = history[history.length - 1];
  canvas.loadFromJSON(prevState, () => {
    if (bgImageObject) {
      canvas.setBackgroundImage(bgImageObject, () => {
        canvas.renderAll();
        historyProcessing = false;
      }, { scaleX: 1, scaleY: 1 });
    } else {
      canvas.renderAll();
      historyProcessing = false;
    }
  });
});

function discardImage() {
  const msg = UI_TEXTS[currentLang].confirmDiscard;
  if (confirm(msg)) ipcRenderer.send('discard-image');
}

btnDiscard.addEventListener('click', discardImage);
btnWindowClose.addEventListener('click', discardImage);

function setTool(tool) {
  currentTool = tool;
  toolPenBtn.classList.toggle('active', tool === 'pen');
  toolRectBtn.classList.toggle('active', tool === 'rect');
  canvas.isDrawingMode = (tool === 'pen');
  canvas.selection = (tool !== 'pen');
}

document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length) {
      canvas.discardActiveObject();
      activeObjects.forEach((obj) => canvas.remove(obj));
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    toolUndoBtn.click();
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) saveAndClose();
  // コピーのショートカット (Ctrl+C)
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    e.preventDefault();
    btnCopy.click();
  }
});

document.querySelectorAll('.color-dot').forEach((dot) => {
  dot.addEventListener('click', (e) => {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    e.target.classList.add('active');
    currentColor = e.target.dataset.color;
    canvas.freeDrawingBrush.color = currentColor;
    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.type === 'rect') {
      activeObject.set('stroke', currentColor);
      canvas.renderAll();
      saveHistory();
    }
  });
});

let rect, isDown, origX, origY;
canvas.on('mouse:down', function(o) {
  if (currentTool !== 'rect' || canvas.getActiveObject()) return;
  isDown = true;
  const pointer = canvas.getPointer(o.e);
  origX = pointer.x; origY = pointer.y;
  rect = new fabric.Rect({
    left: origX, top: origY, originX: 'left', originY: 'top',
    width: pointer.x - origX, height: pointer.y - origY,
    angle: 0, fill: 'transparent', stroke: currentColor, strokeWidth: 5,
    selectable: true
  });
  canvas.add(rect);
});
canvas.on('mouse:move', function(o) {
  if (!isDown) return;
  const pointer = canvas.getPointer(o.e);
  if(origX > pointer.x) rect.set({ left: Math.abs(pointer.x) });
  if(origY > pointer.y) rect.set({ top: Math.abs(pointer.y) });
  rect.set({ width: Math.abs(origX - pointer.x) });
  rect.set({ height: Math.abs(origY - pointer.y) });
  canvas.renderAll();
});
canvas.on('mouse:up', function() { isDown = false; rect?.setCoords(); });

btnSave.addEventListener('click', saveAndClose);

// ★修正：メインプロセスに依頼する
btnCopy.addEventListener('click', () => {
  canvas.discardActiveObject();
  canvas.renderAll();
  const editedImageBase64 = canvas.toDataURL({ format: 'png', quality: 1.0 });
  
  // メインプロセスへ「これコピーして（ついでに履歴も更新して）」と頼む
  ipcRenderer.send('copy-image', editedImageBase64);
});

function saveAndClose() {
  canvas.discardActiveObject();
  canvas.renderAll();
  const editedImage = canvas.toDataURL({ format: 'png', quality: 1.0 });
  
  let finalName = previewLabel.textContent;
  if (chkSeq.checked) {
    evidenceCount++;
  }
  
  ipcRenderer.send('save-edited-image', { image: editedImage, name: finalName });
}

function resetToolState() {
  setTool('pen');
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
  document.querySelector('.color-dot[data-color="#ff4d4d"]').classList.add('active');
  currentColor = '#ff4d4d';
  canvas.freeDrawingBrush.color = currentColor;
}