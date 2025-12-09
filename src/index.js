const { app, BrowserWindow, clipboard, ipcMain, Notification, screen, Tray, Menu, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Store = require('electron-store').default || require('electron-store');

const store = new Store();

const MESSAGES = {
  ja: {
    saveTitle: "保存しました",
    saveBody: (name) => `保存名: ${name}`,
    settingsTitle: "設定完了",
    settingsMsg: "設定を保存しました！",
    copyTitle: "コピー完了",
    copyBody: "画像をクリップボードにコピーしました"
  },
  en: {
    saveTitle: "Saved",
    saveBody: (name) => `Filename: ${name}`,
    settingsTitle: "Settings Saved",
    settingsMsg: "Configuration saved successfully!",
    copyTitle: "Copied",
    copyBody: "Image copied to clipboard"
  }
};

let mainWindow;
let settingsWindow;
let tray;
let lastImageBase64 = '';

const createSettingsWindow = () => {
  if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 400, height: 350, title: "Settings", autoHideMenuBar: true, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => settingsWindow = null);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 0, height: 0, show: false, 
    frame: false, transparent: false, backgroundColor: '#1e1e1e',
    resizable: false, 
    // ★変更: ここではまだ true にしない（表示時に最強設定にする）
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'editor.html'));
  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide(); });
};

const createTray = () => {
  const iconPath = path.join(__dirname, 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings...', click: createSettingsWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('SnipSense');
  tray.setContextMenu(contextMenu);
};

app.on('ready', () => {
  console.log("🚀 SnipSense Started");
  createWindow();
  try { createTray(); } catch(e) {}

  setInterval(async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return;
    const currentImageBase64 = image.toDataURL();
    if (currentImageBase64 === lastImageBase64) return;

    lastImageBase64 = currentImageBase64;
    console.log("\n📸 Screenshot detected!");

    const lang = store.get('language') || 'ja';
    
    // ★変更: マウスカーソルがあるディスプレイを特定する
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);

    const MIN_WINDOW_WIDTH = 700; 
    const imgSize = image.getSize();
    
    // 表示するディスプレイのサイズを基準にする
    const workArea = currentDisplay.workArea;

    let finalWidth = Math.max(imgSize.width + 64, MIN_WINDOW_WIDTH);
    finalWidth = Math.min(finalWidth, workArea.width - 50);
    const CHROME_HEIGHT = 64 + 32 + 160; 
    const finalHeight = Math.min(imgSize.height + CHROME_HEIGHT, workArea.height - 100);

    mainWindow.setContentSize(finalWidth, finalHeight);
    
    // ★変更: マウスがあるディスプレイの中央に配置
    const x = Math.round(workArea.x + (workArea.width - finalWidth) / 2);
    const y = Math.round(workArea.y + (workArea.height - finalHeight) / 2);
    mainWindow.setPosition(x, y);

    // ★重要: ゲームに勝つために「スクリーンセーバー級」の最前面を指定
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    
    mainWindow.show();
    mainWindow.focus(); // フォーカスを奪う
    
    mainWindow.webContents.send('load-image', { image: currentImageBase64, language: lang });

    const initialName = `Screenshot_${getDateString()}.png`;
    mainWindow.webContents.send('set-filename', initialName);

  }, 1000);
});

// IPC
ipcMain.on('open-settings', () => createSettingsWindow());

ipcMain.on('save-settings', (event, settings) => {
  store.set('language', settings.language);
  store.set('savePath', settings.savePath);
  const lang = settings.language || 'ja';
  dialog.showMessageBox(settingsWindow, { type: 'info', title: MESSAGES[lang].settingsTitle, message: MESSAGES[lang].settingsMsg, buttons: ['OK'] })
    .then(() => { if(settingsWindow) settingsWindow.close(); });
});

ipcMain.handle('get-settings', () => {
  return { language: store.get('language'), savePath: store.get('savePath') };
});

ipcMain.on('save-edited-image', (event, data) => {
  const userSavePath = store.get('savePath');
  const saveDir = userSavePath && fs.existsSync(userSavePath) ? userSavePath : path.join(os.homedir(), 'Pictures', 'SnipSense');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  let fileName = data.name || `Screenshot_${getDateString()}.png`;
  if (!fileName.toLowerCase().endsWith('.png')) fileName += '.png';

  const savePath = path.join(saveDir, fileName);
  const base64Image = data.image.replace(/^data:image\/png;base64,/, "");
  
  fs.writeFile(savePath, base64Image, 'base64', (err) => {
    if (!err) {
      const lang = store.get('language') || 'ja';
      new Notification({ title: MESSAGES[lang].saveTitle, body: MESSAGES[lang].saveBody(fileName) }).show();
      mainWindow.hide(); 
    }
  });
});

ipcMain.on('copy-image', (event, base64Data) => {
  const img = nativeImage.createFromDataURL(base64Data);
  clipboard.writeImage(img);
  lastImageBase64 = clipboard.readImage().toDataURL(); 
  const lang = store.get('language') || 'ja';
  new Notification({ title: MESSAGES[lang].copyTitle, body: MESSAGES[lang].copyBody }).show();
  mainWindow.hide();
});

ipcMain.on('discard-image', () => { if (mainWindow) mainWindow.hide(); });

function getDateString() {
  const now = new Date();
  return now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
}