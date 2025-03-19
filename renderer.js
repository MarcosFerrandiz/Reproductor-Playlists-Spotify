const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

const tempDir = path.join(os.tmpdir(), 'spotify-playlist-player');

// Crear directorio temporal si no existe
(async () => {
  try {
    await fs.mkdir(tempDir, { recursive: true });
  } catch (e) {
    console.error('Error creando directorio temporal:', e);
  }
})();

// Determinar los binarios según el sistema operativo
const platform = os.platform();
let ytDlpBinary, ffmpegBinary;

if (platform === 'win32') {
  // Windows
  ytDlpBinary = path.join(__dirname, 'bin', 'yt-dlp.exe');
  ffmpegBinary = path.join(__dirname, 'bin', 'ffmpeg.exe');
} else if (platform === 'darwin') {
  // macOS
  ytDlpBinary = path.join(__dirname, 'bin', 'yt-dlp_macos');
  ffmpegBinary = path.join(__dirname, 'bin', 'ffmpeg_macos');
} else {
  // Linux (y otros sistemas Unix-like)
  ytDlpBinary = path.join(__dirname, 'bin', 'yt-dlp');
  ffmpegBinary = path.join(__dirname, 'bin', 'ffmpeg');
}

// Verificar que los binarios existan
(async () => {
  try {
    await fs.access(ytDlpBinary);
    await fs.access(ffmpegBinary);
    console.log('Binarios de yt-dlp y ffmpeg encontrados:', ytDlpBinary, ffmpegBinary);
  } catch (e) {
    console.error('Error: No se encontraron los binarios de yt-dlp o ffmpeg en la carpeta bin:', e.message);
    process.exit(1); // Salir si los binarios no están disponibles
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

async function downloadSong(title, artists, url) {
  const fileName = `${title} - ${artists}`.replace(/[^a-zA-Z0-9]/g, '_');
  const filePath = path.join(tempDir, `${fileName}.mp3`);

  if (url === '#') {
    console.log(`No se descargará ${title} - ${artists}: URL inválida`);
    return null;
  }

  console.log(`Iniciando descarga de ${title} - ${artists} desde ${url}`);
  return new Promise((resolve) => {
    const process = spawn(ytDlpBinary, [
      url,
      '--extract-audio',
      '--audio-format', 'mp3',
      '-o', filePath,
      '--ffmpeg-location', ffmpegBinary,
      '--ignore-errors',
    ]);

    let stderrOutput = '';
    process.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.log(`yt-dlp stderr: ${data}`);
    });

    process.stdout.on('data', (data) => {
      console.log(`yt-dlp stdout: ${data}`);
    });

    process.on('close', async (code) => {
      console.log(`yt-dlp terminó con código ${code} para ${title} - ${artists}`);
      if (code === 0) {
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > 0) {
            console.log(`Descargado exitosamente: ${filePath}, tamaño: ${stats.size}`);
            resolve(filePath);
          } else {
            await fs.unlink(filePath).catch(() => {});
            console.log(`Archivo vacío: ${filePath}`);
            resolve(null);
          }
        } catch (e) {
          console.error(`Error verificando archivo ${filePath}:`, e);
          resolve(null);
        }
      } else {
        console.error(`yt-dlp falló con código ${code}. Detalles: ${stderrOutput}`);
        await fs.unlink(filePath).catch(() => {});
        resolve(null);
      }
    });

    process.on('error', (err) => {
      console.error('Error ejecutando yt-dlp:', err);
      resolve(null);
    });
  });
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

  const { songQueue, startPlayback } = await processSongsInBatches(songs, 3);
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