const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const tempDir = path.join(os.tmpdir(), 'spotify-playlist-player');

async function cleanupTempFiles() {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('Archivos temporales eliminados al cerrar');
  } catch (e) {
    console.error('Error al limpiar archivos temporales:', e);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(async () => {
  await fs.mkdir(tempDir, { recursive: true }); // Crear directorio temporal
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await cleanupTempFiles();
  if (process.platform !== 'darwin') app.quit();
});