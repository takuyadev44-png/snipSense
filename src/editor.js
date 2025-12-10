const { ipcRenderer } = require('electron');
const fabric = require('fabric').fabric;

const canvas = new fabric.Canvas('editor', { isDrawingMode: true });
let currentColor = '#ff4d4d';
let currentTool = 'pen';
let currentFontSize = 24; // ★追加: 現在のフォントサイズ
let history = [];
let historyProcessing = false;
let bgImageObject = null;
let evidenceCount = 1;
let currentLang = 'ja';

const UI_TEXTS = {
  ja: { confirmDiscard: "保存せずに破棄しますか？", btnSave: "保存" },
  en: { confirmDiscard: "Discard changes?", btnSave: "Save" }
};

const inputPrefix = document.getElementById('input-prefix');
const inputName = document.getElementById('input-name');
const chkSeq = document.getElementById('chk-seq');
const previewLabel = document.getElementById('filename-preview');
const btnSave = document.getElementById('btn-save');
const btnCopy = document.getElementById('btn-copy');
const btnDiscard = document.getElementById('btn-discard');
const btnWindowClose = document.getElementById('btn-window-close');

// ★追加: フォントサイズ入力
const inputFontSize = document.getElementById('input-font-size');

const toolPenBtn = document.getElementById('tool-pen');
const toolRectBtn = document.getElementById('tool-rect');
const toolBubbleBtn = document.getElementById('tool-bubble');
const toolUndoBtn = document.getElementById('tool-undo');
const toolSettingsBtn = document.getElementById('tool-settings');

inputPrefix.addEventListener('input', updatePreview);
inputName.addEventListener('input', updatePreview);
chkSeq.addEventListener('change', updatePreview);

// ★追加: フォントサイズ変更時の処理
inputFontSize.addEventListener('change', (e) => {
  currentFontSize = parseInt(e.target.value, 10) || 24;
  
  // 選択中のオブジェクトがあれば、そのフォントサイズを変更
  const activeObj = canvas.getActiveObject();
  
  // ケース1: 吹き出し（グループ）を選択中
  if (activeObj && activeObj.type === 'group' && activeObj.bubbleId) {
      const textObj = activeObj.getObjects().find(o => o.type === 'i-text');
      if (textObj) {
          textObj.set('fontSize', currentFontSize);
          // グループの大きさを再計算させる
          activeObj.addWithUpdate(); 
          canvas.renderAll();
          saveHistory();
      }
  }
  // ケース2: テキスト編集中（バラバラ状態）
  if (activeObj && activeObj.type === 'i-text') {
      activeObj.set('fontSize', currentFontSize);
      canvas.renderAll();
  }
});

// 選択が変わった時に、入力欄の数値を今のサイズに合わせる
canvas.on('selection:created', updateFontSizeInput);
canvas.on('selection:updated', updateFontSizeInput);

function updateFontSizeInput() {
    const activeObj = canvas.getActiveObject();
    if (activeObj && activeObj.type === 'group' && activeObj.bubbleId) {
        const textObj = activeObj.getObjects().find(o => o.type === 'i-text');
        if (textObj) {
            inputFontSize.value = textObj.fontSize;
            currentFontSize = textObj.fontSize;
        }
    }
}

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
  
  if (UI_TEXTS[currentLang]) {
    btnSave.textContent = UI_TEXTS[currentLang].btnSave;
  }

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

function saveHistory() {
  if (historyProcessing) return;
  if (history.length > 20) history.shift();
  const json = canvas.toObject(['bubbleId']); 
  delete json.backgroundImage; 
  history.push(JSON.stringify(json));
}
canvas.on('object:added', saveHistory);
canvas.on('object:modified', saveHistory);
canvas.on('object:removed', saveHistory);

canvas.freeDrawingBrush.color = currentColor;
canvas.freeDrawingBrush.width = 5;

function setTool(tool) {
  currentTool = tool;
  
  toolPenBtn.classList.toggle('active', tool === 'pen');
  toolRectBtn.classList.toggle('active', tool === 'rect');
  toolBubbleBtn.classList.toggle('active', tool === 'bubble');

  canvas.isDrawingMode = (tool === 'pen');
  canvas.selection = (tool !== 'pen');
}

toolPenBtn.addEventListener('click', () => setTool('pen'));
toolRectBtn.addEventListener('click', () => setTool('rect'));
toolSettingsBtn.addEventListener('click', () => ipcRenderer.send('open-settings'));

toolBubbleBtn.addEventListener('click', () => {
  addBubble();
  setTool('cursor');
});

function addBubble() {
  const uniqueId = 'bubble_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const bubblePath = "M 0 0 L 150 0 Q 160 0 160 10 L 160 70 Q 160 80 150 80 L 60 80 L 30 110 L 40 80 L 10 80 Q 0 80 0 70 L 0 10 Q 0 0 10 0 Z";
  
  const path = new fabric.Path(bubblePath, {
    fill: '#ffffff',
    stroke: currentColor,
    strokeWidth: 3,
    originX: 'left',
    originY: 'top',
    left: 0, top: 0,
    bubbleId: uniqueId
  });

  const text = new fabric.IText('Text', {
    fontSize: currentFontSize, // ★修正: 設定されたサイズを使う
    fontFamily: 'Segoe UI',
    fill: '#000000',
    originX: 'center',
    originY: 'center',
    left: 80, top: 40,
    bubbleId: uniqueId
  });

  const group = new fabric.Group([path, text], {
    left: canvas.width / 2 - 80, 
    top: canvas.height / 2 - 55,
    bubbleId: uniqueId
  });

  canvas.add(group);
  canvas.setActiveObject(group);
  canvas.renderAll();
  saveHistory();
}

canvas.on('mouse:dblclick', function(opt) {
  if (opt.target && opt.target.type === 'group') {
    const group = opt.target;
    const items = group.getObjects();
    const textObj = items.find(o => o.type === 'i-text');
    const pathObj = items.find(o => o.type === 'path');

    if (textObj && pathObj) {
      group.toActiveSelection();
      
      canvas.setActiveObject(textObj);
      textObj.enterEditing();
      textObj.selectAll();

      textObj.off('editing:exited'); 
      textObj.on('editing:exited', () => {
         const allObjects = canvas.getObjects();
         const myId = textObj.bubbleId;
         
         if (myId) {
             const pairObjects = allObjects.filter(o => o.bubbleId === myId);
             
             if (pairObjects.length > 0) {
                 const newSelection = new fabric.ActiveSelection(pairObjects, {
                     canvas: canvas
                 });
                 canvas.setActiveObject(newSelection);
                 newSelection.toGroup();
                 canvas.requestRenderAll();
                 saveHistory();
             }
         }
      });
    }
  }
});

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
    setTool('cursor');
  });
});

function discardImage() {
  if (confirm(UI_TEXTS[currentLang].confirmDiscard)) ipcRenderer.send('discard-image');
}

btnDiscard.addEventListener('click', discardImage);
btnWindowClose.addEventListener('click', discardImage);

document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  
  const activeObj = canvas.getActiveObject();
  if (activeObj && activeObj.isEditing) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length) {
      canvas.discardActiveObject();
      activeObjects.forEach((obj) => canvas.remove(obj));
      saveHistory();
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    toolUndoBtn.click();
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) saveAndClose();
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
    if (activeObject) {
      if (activeObject.type === 'rect') {
        activeObject.set('stroke', currentColor);
      }
      if (activeObject.type === 'group') {
        const items = activeObject.getObjects();
        items.forEach(i => {
           if(i.type === 'path') i.set('stroke', currentColor);
        });
      }
      canvas.renderAll();
      saveHistory();
    }
  });
});

let rect, isDown, origX, origY;
canvas.on('mouse:down', function(o) {
  if (currentTool !== 'rect' || canvas.getActiveObject()) return;
  if (o.target && o.target.isEditing) return;

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
canvas.on('mouse:up', function() { 
    if(isDown) {
        isDown = false; 
        rect?.setCoords();
        saveHistory(); 
    }
});

btnSave.addEventListener('click', saveAndClose);

btnCopy.addEventListener('click', () => {
  canvas.discardActiveObject();
  canvas.renderAll();
  setTimeout(() => {
      const editedImageBase64 = canvas.toDataURL({ format: 'png', quality: 1.0 });
      ipcRenderer.send('copy-image', editedImageBase64);
  }, 100);
});

function saveAndClose() {
  canvas.discardActiveObject();
  canvas.renderAll();
  setTimeout(() => {
    const editedImage = canvas.toDataURL({ format: 'png', quality: 1.0 });
    let finalName = previewLabel.textContent;
    if (chkSeq.checked) {
      evidenceCount++;
    }
    ipcRenderer.send('save-edited-image', { image: editedImage, name: finalName });
  }, 100);
}

function resetToolState() {
  setTool('pen');
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
  document.querySelector('.color-dot[data-color="#ff4d4d"]').classList.add('active');
  currentColor = '#ff4d4d';
  canvas.freeDrawingBrush.color = currentColor;
}