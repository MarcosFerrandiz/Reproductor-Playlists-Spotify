const puppeteer = require('puppeteer');
const { spawn } = require('child_process'); // Usaremos child_process.spawn
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const https = require('https');

// Determinar si la aplicación está empaquetada
const isPackaged = process.env.NODE_ENV === 'production' || (typeof process !== 'undefined' && process.resourcesPath && process.resourcesPath.includes('app.asar'));

// Definir la carpeta donde se guardarán los binarios (ruta estática)
const binDir = path.join(os.homedir(), '.spotify-playlist-player', 'bin'); 
const tempDir = path.join(os.tmpdir(), 'spotify-playlist-player');
let ytDlpBinary, ffmpegBinary;

// Variable para manejar el "lock" de yt-dlp
let isYtDlpRunning = false;

// Crear directorio temporal y bin si no existen
(async () => {
  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    console.log('Directorios creados:', tempDir, binDir);
  } catch (e) {
    console.error('Error creando directorios:', e);
  }
})();

// Descargar un archivo desde una URL usando https
async function downloadFile(url, dest) {
  console.log(`Iniciando descarga de ${url} a ${dest}...`);
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(dest);
    const request = https.get(url, (response) => {
      // Manejar redirects manualmente
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`Redirigiendo a: ${redirectUrl}`);
        downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Error al descargar ${url}: Código de estado ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`Descarga completada: ${dest}`);
        resolve();
      });

      file.on('error', (err) => {
        console.error(`Error al escribir el archivo ${dest}:`, err);
        require('fs').unlink(dest, () => {}); // Eliminar el archivo si hay un error
        reject(err);
      });
    });

    request.on('error', (err) => {
      console.error(`Error en la solicitud de descarga de ${url}:`, err.message);
      require('fs').unlink(dest, () => {}); // Eliminar el archivo si hay un error
      reject(err);
    });

    // Tiempo de espera para la solicitud
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error(`Tiempo de espera excedido al descargar ${url}`));
    });
  });
}

// Configurar los binarios (solo para Windows, ya que solo tienes binarios .exe)
(async () => {
  try {
    const platform = os.platform();
    console.log('Sistema operativo detectado:', platform);
    console.log('¿Aplicación empaquetada?:', isPackaged);
    console.log('Ruta de binDir:', binDir);

    if (platform !== 'win32') {
      console.error('Este programa solo es compatible con Windows, ya que los binarios para otros sistemas operativos no están disponibles.');
      const resultsDiv = document.getElementById('results');
      if (resultsDiv) {
        resultsDiv.innerHTML = `<p class="error">Este programa solo es compatible con Windows. Los binarios para ${platform} no están disponibles.</p>`;
      }
      return;
    }

    // Configurar binarios para Windows
    ytDlpBinary = path.join(binDir, 'yt-dlp.exe');
    ffmpegBinary = path.join(binDir, 'ffmpeg.exe');

    // Verificar si yt-dlp.exe existe
    if (!(await fs.access(ytDlpBinary).then(() => true).catch(() => false))) {
      console.log('yt-dlp.exe no encontrado, descargando...');
      await downloadFile('https://github.com/MarcosFerrandiz/Reproductor-Playlists-Spotify/releases/download/v1.0.0/yt-dlp.exe', ytDlpBinary);
    } else {
      console.log('yt-dlp.exe ya existe:', ytDlpBinary);
    }

    // Verificar si ffmpeg.exe existe
    if (!(await fs.access(ffmpegBinary).then(() => true).catch(() => false))) {
      console.log('ffmpeg.exe no encontrado, descargando...');
      await downloadFile('https://github.com/MarcosFerrandiz/Reproductor-Playlists-Spotify/releases/download/v1.0.0/ffmpeg.exe', ffmpegBinary);
    } else {
      console.log('ffmpeg.exe ya existe:', ffmpegBinary);
    }

    // Verificar que los archivos sean válidos (tengan un tamaño mayor a 0)
    const ytDlpStats = await fs.stat(ytDlpBinary);
    if (ytDlpStats.size === 0) {
      console.log('yt-dlp.exe está vacío, re-descargando...');
      await fs.unlink(ytDlpBinary); // Eliminar el archivo vacío
      await downloadFile('https://github.com/MarcosFerrandiz/Reproductor-Playlists-Spotify/releases/download/v1.0.0/yt-dlp.exe', ytDlpBinary);
    }

    const ffmpegStats = await fs.stat(ffmpegBinary);
    if (ffmpegStats.size === 0) {
      console.log('ffmpeg.exe está vacío, re-descargando...');
      await fs.unlink(ffmpegBinary); // Eliminar el archivo vacío
      await downloadFile('https://github.com/MarcosFerrandiz/Reproductor-Playlists-Spotify/releases/download/v1.0.0/ffmpeg.exe', ffmpegBinary);
    }

    console.log('Binarios de yt-dlp y ffmpeg configurados:', ytDlpBinary, ffmpegBinary);
  } catch (e) {
    console.error('Error al configurar los binarios:', e);
    // Mostrar un mensaje en la interfaz de usuario
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) {
      resultsDiv.innerHTML = `<p class="error">Error al descargar los binarios necesarios: ${e.message}. Por favor, verifica tu conexión a internet y las URLs de los binarios.</p>`;
    }
    return;
  }
})();

async function getPlaylistSongs(playlistName) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  console.log('Buscando playlist en Spotify:', playlistName);

  try {
    await page.goto(`https://open.spotify.com/search/${encodeURIComponent(playlistName)}/playlists`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForSelector('div[data-testid="grid-container"] a', { timeout: 30000 });
    const playlistLink = await page.evaluate(() => {
      const link = document.querySelector('div[data-testid="grid-container"] a');
      console.log('Link encontrado:', link ? link.href : 'Ninguno');
      return link ? link.href : null;
    });

    if (!playlistLink) {
      throw new Error('No se encontró ninguna playlist');
    }

    console.log('Navegando a la playlist:', playlistLink);
    await page.goto(playlistLink, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForSelector('div[data-testid="tracklist-row"]', { timeout: 10000 });
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    });

    const songs = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div[data-testid="tracklist-row"]'));
      console.log('Filas encontradas:', rows.length);
      return rows.map((row) => {
        const titleElement = row.querySelector('div[data-testid="tracklist-row"] a div');
        const artistElement = row.querySelector('.e-9640-text.encore-text-body-small');
        const coverElement = row.querySelector('img.mMx2LUixlnN_Fu45JpFB.IqDKYprOtD_EJR1WClPv.Yn2Ei5QZn19gria6LjZj');
        const fallbackCoverElement = row.querySelector('img[src*="i.scdn.co"]');
        const title = titleElement ? titleElement.textContent.trim() : 'Sin título';
        const artists = artistElement ? artistElement.textContent.trim() : 'Desconocido';
        const cover = coverElement ? coverElement.src : (fallbackCoverElement ? fallbackCoverElement.src : 'https://placehold.co/300x300?text=Sin+Portada');
        console.log(`Canción scrapeada: Título: ${title}, Artistas: ${artists}, Portada: ${cover}`);
        return { title, artists, cover };
      });
    });

    console.log('Canciones encontradas:', songs.length);
    await browser.close();
    return songs;
  } catch (e) {
    console.error('Error buscando playlist:', e);
    await browser.close();
    return [];
  }
}

async function searchYouTube(song) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  try {
    const query = `${song.title} ${song.artists}`;
    console.log('Buscando en YouTube:', query);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const captchaCheck = await page.evaluate(() => {
      return document.querySelector('form#captcha-form') ? 'CAPTCHA detectado' : null;
    });
    if (captchaCheck) {
      console.log('CAPTCHA detectado en YouTube, búsqueda abortada para:', query);
      await browser.close();
      return '#';
    }

    await page.waitForSelector('a#video-title', { timeout: 30000 });

    const video = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('a#video-title'));
      for (const video of videos) {
        const href = video.getAttribute('href');
        const isAd = video.closest('ytd-promoted-video-renderer') || video.closest('ytd-ad-slot-renderer');
        if (!isAd && href) {
          const title = video.textContent.trim();
          const channelElement = video.closest('ytd-video-renderer')?.querySelector('yt-formatted-string');
          const channel = channelElement ? channelElement.textContent.trim() : 'desconocido';
          console.log(`Primer video encontrado - Título: ${title}, Canal: ${channel}, URL: https://www.youtube.com${href}`);
          return `https://www.youtube.com${href}`;
        }
      }
      console.log('No se encontró ningún video válido (sin anuncios) para:', query);
      return null;
    });

    console.log('URL de YouTube scrapeada:', video || 'No se encontró video');
    await browser.close();
    return video || '#';
  } catch (e) {
    console.error('Error buscando en YouTube:', e.message);
    try {
      const retryQuery = `${song.title} ${song.artists}`;
      console.log('Reintentando búsqueda en YouTube para:', retryQuery);
      const retryPage = await browser.newPage();
      await retryPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await retryPage.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(retryQuery)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      await new Promise(resolve => setTimeout(resolve, 2000));
      const captchaCheckRetry = await retryPage.evaluate(() => {
        return document.querySelector('form#captcha-form') ? 'CAPTCHA detectado' : null;
      });
      if (captchaCheckRetry) {
        console.log('CAPTCHA detectado en reintento para:', retryQuery);
        await browser.close();
        return '#';
      }

      await retryPage.waitForSelector('a#video-title', { timeout: 30000 });
      const video = await retryPage.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('a#video-title'));
        for (const video of videos) {
          const href = video.getAttribute('href');
          const isAd = video.closest('ytd-promoted-video-renderer') || video.closest('ytd-ad-slot-renderer');
          if (!isAd && href) {
            const title = video.textContent.trim();
            const channelElement = video.closest('ytd-video-renderer')?.querySelector('yt-formatted-string');
            const channel = channelElement ? channelElement.textContent.trim() : 'desconocido';
            console.log(`Primer video encontrado (reintento) - Título: ${title}, Canal: ${channel}, URL: https://www.youtube.com${href}`);
            return `https://www.youtube.com${href}`;
          }
        }
        console.log('No se encontró ningún video válido (sin anuncios) en reintento para:', retryQuery);
        return null;
      });

      console.log('URL de YouTube scrapeada (reintento):', video || 'No se encontró video');
      await browser.close();
      return video || '#';
    } catch (retryError) {
      console.error('Reintento falló:', retryError.message);
      await browser.close();
      return '#';
    }
  }
}

async function downloadSong(title, artists, url, maxRetries = 3, retryDelay = 2000) {
  const fileName = `${title} - ${artists}`.replace(/[^a-zA-Z0-9]/g, '_');
  const filePath = path.join(tempDir, `${fileName}.mp3`);

  if (url === '#') {
    console.log(`No se descargará ${title} - ${artists}: URL inválida`);
    return null;
  }

  // Verificar que los binarios existan antes de intentar usarlos
  if (!(await fs.access(ytDlpBinary).then(() => true).catch(() => false))) {
    console.error(`El binario yt-dlp.exe no existe en: ${ytDlpBinary}`);
    return null;
  }

  if (!(await fs.access(ffmpegBinary).then(() => true).catch(() => false))) {
    console.error(`El binario ffmpeg.exe no existe en: ${ffmpegBinary}`);
    return null;
  }

  console.log(`Iniciando descarga de ${title} - ${artists} desde ${url}`);

  // Esperar hasta que yt-dlp esté disponible (lock)
  while (isYtDlpRunning) {
    console.log(`Esperando a que yt-dlp esté disponible para ${title} - ${artists}...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  isYtDlpRunning = true;

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      console.log(`Ejecutando yt-dlp (intento ${attempt + 1}/${maxRetries}) para ${title} - ${artists}...`);

      // Usar child_process.spawn para ejecutar yt-dlp.exe
      const process = spawn(ytDlpBinary, [
        url,
        '--extract-audio',
        '--audio-format', 'mp3',
        '-o', filePath,
        '--ffmpeg-location', ffmpegBinary,
        '--ignore-errors',
        '--verbose',
      ]);

      // Capturar la salida en tiempo real
      let lastOutput = '';
      process.stdout.on('data', (data) => {
        lastOutput = data.toString();
        console.log(`yt-dlp stdout: ${lastOutput}`);
      });

      process.stderr.on('data', (data) => {
        lastOutput = data.toString();
        console.log(`yt-dlp stderr: ${lastOutput}`);
      });

      // Manejar el tiempo de espera manualmente
      const timeout = setTimeout(() => {
        console.error(`Tiempo de espera excedido para la descarga de ${title} - ${artists}. Última salida: ${lastOutput || 'No se recibió salida'}`);
        process.kill();
        isYtDlpRunning = false;
        resolve(null);
      }, 300000); // 5 minutos de tiempo de espera

      // Promesa para esperar a que el proceso termine
      const result = await new Promise((resolve) => {
        process.on('close', async (code) => {
          clearTimeout(timeout); // Cancelar el timeout si el proceso termina antes

          if (code !== 0) {
            console.error(`yt-dlp terminó con código de error ${code}. Última salida: ${lastOutput || 'No se recibió salida'}`);
            isYtDlpRunning = false;
            resolve(null);
            return;
          }

          try {
            const stats = await fs.stat(filePath);
            if (stats.size > 0) {
              console.log(`Descargado exitosamente: ${filePath}, tamaño: ${stats.size}`);
              isYtDlpRunning = false;
              resolve(filePath);
            } else {
              await fs.unlink(filePath).catch(() => {});
              console.log(`Archivo vacío: ${filePath}`);
              isYtDlpRunning = false;
              resolve(null);
            }
          } catch (e) {
            console.error(`Error verificando archivo ${filePath}:`, e);
            isYtDlpRunning = false;
            resolve(null);
          }
        });

        process.on('error', (err) => {
          clearTimeout(timeout);
          console.error(`Error ejecutando yt-dlp para ${title} - ${artists}:`, err);
          isYtDlpRunning = false;
          resolve(null);
        });
      });

      if (result) {
        return result; // Si la descarga fue exitosa, retornamos el filePath
      }

      attempt++;
      if (attempt < maxRetries) {
        console.log(`Reintentando (${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    } catch (e) {
      attempt++;
      console.error(`Error ejecutando yt-dlp para ${title} - ${artists}:`, e);
      if (attempt < maxRetries) {
        console.log(`Reintentando (${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error(`Fallo después de ${maxRetries} intentos: ${e.message}`);
        await fs.unlink(filePath).catch(() => {});
        isYtDlpRunning = false;
        return null;
      }
    }
  }

  console.error(`No se pudo descargar ${title} - ${artists} después de ${maxRetries} intentos.`);
  isYtDlpRunning = false;
  return null;
}

async function processSongsInBatches(songs, batchSize) {
  const songQueue = [];
  let isPlaying = false;

  for (let i = 0; i < songs.length; i += batchSize) {
    const batch = songs.slice(i, i + batchSize);
    console.log(`Procesando lote ${Math.floor(i / batchSize) + 1}: ${batch.length} canciones`);
    const batchPromises = batch.map(async (song) => {
      try {
        const url = await searchYouTube(song);
        if (url !== '#') {
          const filePath = await downloadSong(song.title, song.artists, url);
          if (filePath) {
            songQueue.push({ title: song.title, artists: song.artists, filePath, url, cover: song.cover });
            console.log(`Añadido a la cola: ${song.title} - ${song.artists} (${url})`);
          } else {
            console.log(`No se pudo descargar ${song.title} - ${song.artists}, pero continuamos`);
            songQueue.push({ title: song.title, artists: song.artists, filePath: null, url, cover: song.cover });
          }
        } else {
          console.log(`No se encontró URL válida para ${song.title} - ${song.artists}`);
          songQueue.push({ title: song.title, artists: song.artists, filePath: null, url: '#', cover: song.cover });
        }
      } catch (e) {
        console.error(`Error procesando ${song.title} - ${song.artists}:`, e);
        songQueue.push({ title: song.title, artists: song.artists, filePath: null, url: '#', cover: song.cover });
      }
    });

    await Promise.all(batchPromises);
    console.log(`Lote ${Math.floor(i / batchSize) + 1} completado. Cola actual: ${songQueue.length} canciones`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!isPlaying && songQueue.some(song => song.filePath)) {
      isPlaying = true;
      console.log('Iniciando reproducción con el primer lote');
    }
  }

  return { songQueue, startPlayback: isPlaying };
}

async function playSong(filePath, audio, onEndCallback) {
  if (!filePath) {
    console.log('No hay archivo para reproducir');
    return Promise.resolve();
  }
  const audioUrl = URL.createObjectURL(new Blob([await fs.readFile(filePath)], { type: 'audio/mp3' }));
  audio.src = audioUrl;

  return new Promise((resolve) => {
    audio.onloadeddata = () => console.log('Audio cargado');
    audio.oncanplay = () => {
      console.log('Reproducción iniciada');
      audio.play().catch(err => {
        console.error('Error al reproducir:', err);
        resolve();
      });
    };
    audio.onended = () => {
      console.log('Canción terminada');
      URL.revokeObjectURL(audioUrl);
      fs.unlink(filePath).then(() => console.log(`Eliminado: ${filePath}`)).catch(() => {});
      onEndCallback();
      resolve();
    };
    audio.onerror = (err) => {
      console.error('Error en reproducción:', err);
      URL.revokeObjectURL(audioUrl);
      fs.unlink(filePath).catch(() => {});
      resolve();
    };
  });
}

async function playPlaylist(playlistName) {
  const resultsDiv = document.getElementById('results');
  const currentSongSpan = document.getElementById('current-song');
  const audio = document.getElementById('audio-player');
  const nextBtn = document.getElementById('next-btn');
  const shuffleBtn = document.getElementById('shuffle-btn');
  const albumCover = document.getElementById('album-cover');
  const mediaTitle = document.getElementById('media-title');
  const mediaArtists = document.getElementById('media-artists');

  resultsDiv.innerHTML = '<p class="placeholder">Buscando playlist...</p>';
  nextBtn.disabled = true;
  shuffleBtn.disabled = true;

  const songs = await getPlaylistSongs(playlistName);
  if (songs.length === 0) {
    resultsDiv.innerHTML = '<p class="placeholder">No se encontraron canciones.</p>';
    return;
  }

  resultsDiv.innerHTML = songs.map(song => `<p data-index="${songs.indexOf(song)}">${song.title} - <span>${song.artists}</span></p>`).join('');
  console.log('Procesando canciones en lotes...');

  const { songQueue, startPlayback } = await processSongsInBatches(songs, 1); // Mantenemos batchSize en 1
  let currentIndex = -1;
  let isPlayingFromQueue = true;

  renderSongList();

  if (startPlayback) {
    nextBtn.disabled = false;
    shuffleBtn.disabled = false;
    currentIndex = 0;
    playSongAtIndex(currentIndex);
  }

  function renderSongList() {
    resultsDiv.innerHTML = songQueue.map((song, index) => 
      `<p data-index="${index}" class="${index === currentIndex ? 'selected' : ''}">${song.title} - <span>${song.artists}</span></p>`
    ).join('');
    assignClickEvents();
    updateMediaContent();
  }

  function assignClickEvents() {
    resultsDiv.querySelectorAll('p').forEach((p) => {
      p.addEventListener('click', () => {
        const index = parseInt(p.getAttribute('data-index'));
        if (index >= 0 && index < songQueue.length) {
          audio.pause();
          audio.currentTime = 0;
          currentIndex = index;
          isPlayingFromQueue = true;
          playSongAtIndex(currentIndex);
        }
      });
    });
  }

  async function playSongAtIndex(index) {
    if (index < 0 || index >= songQueue.length) {
      currentSongSpan.textContent = 'Fin de la playlist';
      nextBtn.disabled = true;
      shuffleBtn.disabled = true;
      currentIndex = -1;
      albumCover.src = 'https://placehold.co/300x300?text=Sin+Portada';
      mediaTitle.textContent = 'Fin de la playlist';
      mediaArtists.textContent = '';
      renderSongList();
      return;
    }

    const song = songQueue[index];
    currentSongSpan.textContent = `${song.title} - ${song.artists}`;
    renderSongList();

    await playSong(song.filePath, audio, () => {
      songQueue.splice(index, 1);
      if (songQueue.length === 0) {
        currentSongSpan.textContent = 'Fin de la playlist';
        nextBtn.disabled = true;
        shuffleBtn.disabled = true;
        currentIndex = -1;
        albumCover.src = 'https://placehold.co/300x300?text=Sin+Portada';
        mediaTitle.textContent = 'Fin de la playlist';
        mediaArtists.textContent = '';
        renderSongList();
        return;
      }

      if (isPlayingFromQueue) {
        currentIndex = 0;
        playSongAtIndex(currentIndex);
      }
    });
  }

  function skipToNext() {
    if (songQueue.length === 0) {
      currentSongSpan.textContent = 'Fin de la playlist';
      nextBtn.disabled = true;
      shuffleBtn.disabled = true;
      currentIndex = -1;
      albumCover.src = 'https://placehold.co/300x300?text=Sin+Portada';
      mediaTitle.textContent = 'Fin de la playlist';
      mediaArtists.textContent = '';
      renderSongList();
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    isPlayingFromQueue = true;

    if (currentIndex >= 0 && currentIndex < songQueue.length) {
      songQueue.splice(currentIndex, 1);
      currentIndex = 0;
    } else {
      currentIndex = 0;
    }

    playSongAtIndex(currentIndex);
  }

  function shuffleQueue() {
    for (let i = songQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songQueue[i], songQueue[j]] = [songQueue[j], songQueue[i]];
    }
    console.log('Cola mezclada:', songQueue.map(s => `${s.title} - ${s.artists}`));
    currentIndex = -1;
    isPlayingFromQueue = true;
    renderSongList();
    currentIndex = 0;
    playSongAtIndex(currentIndex);
  }

  function updateMediaContent() {
    if (currentIndex < 0 || currentIndex >= songQueue.length) {
      albumCover.src = 'https://placehold.co/300x300?text=Sin+Portada';
      mediaTitle.textContent = 'Selecciona una canción';
      mediaArtists.textContent = 'Artistas';
      return;
    }

    const song = songQueue[currentIndex];
    albumCover.src = song.cover || 'https://placehold.co/300x300?text=Sin+Portada';
    mediaTitle.textContent = song.title;
    mediaArtists.textContent = song.artists;
  }

  nextBtn.onclick = skipToNext;
  shuffleBtn.onclick = shuffleQueue;

  if (!songQueue.some(song => song.filePath)) {
    currentSongSpan.textContent = 'No se encontraron canciones reproducibles';
  }
}

document.getElementById('play-btn').addEventListener('click', async () => {
  const playlistName = document.getElementById('playlist-input').value.trim();
  if (!playlistName) {
    document.getElementById('results').innerHTML = '<p class="placeholder">Ingresa el nombre de una playlist.</p>';
    return;
  }
  await playPlaylist(playlistName);
});
