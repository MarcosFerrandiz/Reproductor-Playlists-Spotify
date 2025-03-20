# 🎵 Reproductor de Playlists de Spotify

## 📋 Descripción

**Reproductor de Playlists de Spotify** es una aplicación de escritorio que te permite disfrutar de tus playlists favoritas de Spotify sin necesidad de una suscripción premium. La aplicación busca las canciones de una playlist en Spotify, las descarga desde YouTube y las reproduce localmente en formato MP3. Todo esto con una interfaz sencilla y controles básicos para una experiencia de usuario fluida.

### ✨ Funcionalidades

- **Búsqueda de Playlists**: Ingresa el nombre de una playlist de Spotify (Debe de ser pública) y la aplicación buscará las canciones automáticamente.
- **Descarga desde YouTube**: Busca y descarga las canciones desde YouTube usando `yt-dlp`, convirtiéndolas a MP3 con `ffmpeg`.
- **Reproducción Local**: Reproduce las canciones descargadas con controles como:
  - **Siguiente Canción**: Pasa a la siguiente canción de la cola.
  - **Mezclar (Shuffle)**: Reordena las canciones de manera aleatoria.
  - **Selección Manual**: Haz clic en una canción de la lista para reproducirla.
- **Gestión de Archivos**: Los archivos MP3 se eliminan automáticamente después de reproducirse para ahorrar espacio.
- **Interfaz Gráfica**: Muestra el título, los artistas y la portada de cada canción mientras se reproduce.

---

## 🚀 Instalación y Ejecución

Sigue estos pasos para instalar y ejecutar el proyecto en tu computadora. Actualmente, la aplicación está diseñada para funcionar en **Windows**, ya que utiliza binarios `.exe` (`yt-dlp.exe` y `ffmpeg.exe`).

### 📋 Requisitos Previos

Antes de comenzar, asegúrate de tener instalado lo siguiente:

- **Node.js y npm**: Descarga e instala la versión LTS desde [https://nodejs.org/](https://nodejs.org/). Verifica la instalación con:
  ```bash
  node -v
  npm -v
---

  ### 📥 Pasos para Instalar

#### 1. Clonar o Descargar el Repositorio

**Opción 1: Clonar el Repositorio**  
  ```bash
git clone https://github.com/MarcosFerrandiz/Reproductor-Playlists-Spotify.git
cd Reproductor-Playlists-Spotify
```
---

**Opción 2: Descargar como ZIP**  
1. Ve a [https://github.com/MarcosFerrandiz/Reproductor-Playlists-Spotify](https://github.com/MarcosFerrandiz/Reproductor-Playlists-Spotify).  
2. Haz clic en el botón verde **Code** y selecciona **Download ZIP**.  
3. Descomprime el archivo ZIP y navega a la carpeta descomprimida:  
   ```bash
   cd ruta/a/Reproductor-Playlists-Spotify
4. En la carpeta del proyecto, ejecuta:
  ```bash
npm install
