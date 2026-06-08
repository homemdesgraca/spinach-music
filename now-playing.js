(() => {
const nowPlayingBar = document.querySelector('.now-playing-bar');
const coverThemeButton = document.querySelector('.cover-theme-button');
const nowPlayingTitle = document.querySelector('#now-playing-title');
const nowPlayingAlbum = document.querySelector('#now-playing-album');
const nowPlayingArtist = document.querySelector('#now-playing-artist');
const nowPlayingCover = document.querySelector('#now-playing-cover');
const nowPlayingTimer = document.querySelector('#now-playing-timer');
const nowPlayingStatusPill = document.querySelector('.now-playing-status-pill');
const nowPlayingProgress = document.querySelector('#now-playing-progress');
const playerVolumeSlider = document.querySelector('#player-volume-slider');
const playerVolumeValue = document.querySelector('#player-volume-value');
const progressTimeBubble = document.querySelector('#progress-time-bubble');
const nowPlayingTitleLine = document.querySelector('.now-playing-title-line');
const nowPlayingArtistLine = document.querySelector('.now-playing-artist-line');
const playerControls = document.querySelectorAll('.player-control');
const playPauseControl = document.querySelector('[data-mpris-action="toggle"]');
const coverThemeToggle = document.querySelector('#cover-theme-toggle');
const lyricsDrawer = document.querySelector('.lyrics-drawer');
const lyricsTab = document.querySelector('.lyrics-tab');
const lyricsClose = document.querySelector('.lyrics-close');
const lyricsCard = document.querySelector('.lyrics-card');
const lyricsStatus = document.querySelector('#lyrics-status');
const lyricsLines = document.querySelector('#lyrics-lines');

const MPRIS_URL = '/mpris';
const MPRIS_CONTROL_URL = '/mpris/control';
const LYRICS_URL = '/lyrics';
const MPRIS_POLL_INTERVAL = 1000;
const ADAPTIVE_COLORS_STORAGE_KEY = 'spinachMusic.adaptiveCoverColors';
const COVER_BACKGROUND_STORAGE_KEY = 'spinachMusic.coverBackground';
const HIGH_RES_BACKGROUND_STORAGE_KEY = 'spinachMusic.highResBackgroundCovers';
const NAVIDROME_STORAGE_KEY = 'spinachMusic.navidromeConnection';
const PLAYER_SOURCE_STORAGE_KEY = 'spinachMusic.playerSource';
const VOLUME_STORAGE_KEY = 'spinachMusic.volume';
const LAST_SONG_STORAGE_KEY = 'spinachMusic.lastSong';
const SUBSONIC_VERSION = '1.16.1';
const CLIENT_NAME = 'spinach-music';

const root = document.documentElement;
const defaultTheme = {
    '--color-page-bg': '#74c69d',
    '--color-text': 'green',
    '--color-shadow': '#0b5d1e',
    '--color-surface': '#95d5b2',
    '--color-surface-hover': '#b7e4c7',
    '--color-input-bg': '#d8f3dc',
    '--color-on-input': 'green',
    '--color-disc-line': 'rgba(11, 93, 30, 0.22)',
};

let isFetchingMpris = false;
let playbackState = 'stopped';
let playerSource = localStorage.getItem(PLAYER_SOURCE_STORAGE_KEY) === 'mpris' ? 'mpris' : 'navidrome';
let renderedPlayerSource = '';
let forceNextPlayerRender = true;
let mprisPollTimer;
let mprisFetchRun = 0;
let pendingForcedMprisRefresh = false;
let mprisVolumeTimer;
let lastTrackId = '';
let lastCoverUrl = '';
const marquees = new Map();
let titleMarqueeToken = 0;
let isScrubbingProgress = false;
let currentDuration = 0;
let currentCoverUrl = '';
let appliedCoverBackgroundUrl = '';
let appliedCoverBackgroundIdentity = '';
let coverBackgroundRun = 0;
let currentSongData = null;
const hintedCoverBackgrounds = new Map();
let lastLyricsKey = '';
let lyricsEntries = [];
let activeLyricsIndex = -1;
let isFetchingLyrics = false;
let pendingLyricsRefresh = false;
let lyricsFetchToken = 0;
let lyricsAbortController;
let lyricsResizeAnimation;
let lyricsRenderTimer;

try {
    const savedCoverBackground = JSON.parse(localStorage.getItem(COVER_BACKGROUND_STORAGE_KEY) || 'null');
    appliedCoverBackgroundUrl = savedCoverBackground?.url || '';
    appliedCoverBackgroundIdentity = savedCoverBackground?.identity || '';
} catch {}

let coverBackgroundEnabled = true;
let adaptiveCoverColorsEnabled = localStorage.getItem(ADAPTIVE_COLORS_STORAGE_KEY) !== 'false';

const getPlayerSource = () => localStorage.getItem(PLAYER_SOURCE_STORAGE_KEY) === 'mpris' ? 'mpris' : 'navidrome';

const isMprisSource = () => playerSource === 'mpris';

const normalizePlaybackState = (state) => {
    const normalized = String(state || '').toLowerCase();

    if (normalized.includes('play')) {
        return 'playing';
    }

    if (normalized.includes('pause')) {
        return 'paused';
    }

    return 'stopped';
};

const formatPlaybackTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '--:--';
    }

    const rounded = Math.floor(seconds);
    const minutes = Math.floor(rounded / 60);
    const remainingSeconds = String(rounded % 60).padStart(2, '0');

    return `${minutes}:${remainingSeconds}`;
};

const formatSongMeta = (album, artist) => ({
    album: album || '',
    artist: artist || '',
});

const formatLyricsKey = (data = {}) => [data.title, data.artist, data.album, Math.round(data.duration || 0)].join('|');

const parseLyricsTimestamp = (minutes, seconds) => (Number(minutes) * 60) + Number(seconds);

const parseSyncedLyrics = (lyrics = '') => lyrics
    .split('\n')
    .map((line) => {
        const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        return match ? { time: parseLyricsTimestamp(match[1], match[2]), text: match[3].trim() } : null;
    })
    .filter((entry) => entry && entry.text);

const loadNavidromeConnection = () => {
    try {
        return JSON.parse(localStorage.getItem(NAVIDROME_STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
};

const normalizeServerUrl = (rawUrl) => {
    const normalized = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
        ? rawUrl
        : `https://${rawUrl}`;
    const baseUrl = new URL(normalized);

    if (!baseUrl.pathname.endsWith('/')) {
        baseUrl.pathname += '/';
    }

    return baseUrl;
};

const fetchNavidromeLyrics = async (songData, signal) => {
    const connection = loadNavidromeConnection();

    if (!connection?.url || !connection?.username || !connection?.password || !songData?.title) {
        throw new Error('no navidrome connection');
    }

    const url = new URL('/navidrome/lyrics', window.location.origin);
    url.searchParams.set('url', connection.url);
    url.searchParams.set('username', connection.username);
    url.searchParams.set('password', connection.password);
    url.searchParams.set('title', songData.title);
    url.searchParams.set('artist', songData.artist || '');
    url.searchParams.set('album', songData.album || '');
    url.searchParams.set('duration', String(songData.duration || ''));

    const response = await fetch(url.toString(), { cache: 'no-store', signal });
    const payload = await response.json();

    if (!response.ok || payload?.found === false || payload?.ok === false) {
        throw new Error(payload?.error || 'navidrome lyrics not found');
    }

    return payload;
};

const fetchLrclibLyrics = async (songData, signal) => {
    const url = new URL(LYRICS_URL, window.location.origin);
    url.searchParams.set('title', songData.title);
    url.searchParams.set('artist', songData.artist);
    url.searchParams.set('album', songData.album || '');
    url.searchParams.set('duration', String(songData.duration || ''));

    const response = await fetch(url.toString(), { cache: 'no-store', signal });
    const payload = await response.json();
    if (!response.ok || payload?.found === false || payload?.ok === false) {
        throw new Error(payload?.error || 'lyrics not found');
    }

    return {
        ...payload,
        source: 'lrclib',
    };
};

const setLyricsStatus = (message) => {
    if (lyricsStatus) {
        lyricsStatus.textContent = message;
    }
};

const isLyricsDrawerOpen = () => lyricsDrawer?.classList.contains('open');

const fillLyricsLines = (entries, plainLyrics = '') => {
    lyricsLines.innerHTML = '';

    if (entries.length) {
        entries.forEach((entry, index) => {
            const line = document.createElement('p');
            line.className = 'lyrics-line';
            line.dataset.index = String(index);
            line.dataset.time = String(entry.time);
            line.title = `jump to ${formatPlaybackTime(entry.time)}`;
            line.textContent = entry.text;
            lyricsLines.append(line);
        });
        return;
    }

    plainLyrics.split('\n').filter(Boolean).forEach((text) => {
        const line = document.createElement('p');
        line.className = 'lyrics-line';
        line.textContent = text.trim();
        lyricsLines.append(line);
    });
};

const getLyricsCardTargetHeight = () => {
    const maxHeight = Number.parseFloat(getComputedStyle(lyricsCard).maxHeight) || Infinity;
    return Math.min(lyricsCard.scrollHeight, maxHeight);
};

const renderLyrics = (entries, plainLyrics = '', options = {}) => {
    if (!lyricsLines) {
        return;
    }

    if (!lyricsCard || !isLyricsDrawerOpen()) {
        fillLyricsLines(entries, plainLyrics);
        return;
    }

    window.clearTimeout(lyricsRenderTimer);

    lyricsRenderTimer = window.setTimeout(() => {
        if (!isLyricsDrawerOpen()) {
            fillLyricsLines(entries, plainLyrics);
            lyricsCard.style.height = '';
            return;
        }

        lyricsResizeAnimation?.cancel();

        const startHeight = lyricsCard.getBoundingClientRect().height;
        lyricsCard.style.height = `${startHeight}px`;
        fillLyricsLines(entries, plainLyrics);

        const targetHeight = getLyricsCardTargetHeight();
        const isShrinking = targetHeight < startHeight - 2;
        const duration = isShrinking ? 1150 : 680;

        lyricsResizeAnimation = lyricsCard.animate([
            { height: `${startHeight}px` },
            { height: `${targetHeight}px` },
        ], {
            duration,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'both',
        });

        lyricsResizeAnimation.onfinish = () => {
            lyricsCard.style.height = '';
            lyricsResizeAnimation = null;
        };
    }, options.delayShrink ? 420 : 0);
};

const resetLyricsState = (status = 'tap the card to fetch lyrics', options = {}) => {
    lyricsAbortController?.abort();
    lyricsFetchToken += 1;
    clearTimeout(lyricsRenderTimer);
    lyricsResizeAnimation?.cancel();
    lyricsResizeAnimation = null;
    if (lyricsCard) {
        lyricsCard.style.height = '';
    }
    currentSongData = options.clearSong === false ? currentSongData : null;
    lastLyricsKey = '';
    lyricsEntries = [];
    activeLyricsIndex = -1;
    isFetchingLyrics = false;
    pendingLyricsRefresh = false;
    renderLyrics([], '', { delayShrink: Boolean(options.delayShrink) });
    setLyricsStatus(status);
};

const syncLyricsToPosition = (position) => {
    if (!lyricsEntries.length || !lyricsLines || !Number.isFinite(position)) {
        return;
    }

    const nextIndex = lyricsEntries.findIndex((entry, index) => {
        const next = lyricsEntries[index + 1];
        return position >= entry.time && (!next || position < next.time);
    });

    if (nextIndex < 0 || nextIndex === activeLyricsIndex) {
        return;
    }

    lyricsLines.querySelector('.lyrics-line.active')?.classList.remove('active');
    const activeLine = lyricsLines.querySelector(`[data-index="${nextIndex}"]`);
    activeLine?.classList.add('active');
    activeLine?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    activeLyricsIndex = nextIndex;
};

const fetchLyrics = async (force = false) => {
    const songData = currentSongData ? { ...currentSongData } : null;

    if (!songData?.title || !songData?.artist) {
        setLyricsStatus('no song info yet');
        return;
    }

    if (isFetchingLyrics) {
        lyricsAbortController?.abort();
        pendingLyricsRefresh = false;
    }

    const lyricsKey = formatLyricsKey(songData);
    if (!force && lyricsKey === lastLyricsKey && lyricsEntries.length) {
        syncLyricsToPosition(songData.position);
        return;
    }

    const fetchToken = ++lyricsFetchToken;
    lyricsAbortController = new AbortController();

    try {
        isFetchingLyrics = true;
        setLyricsStatus('fetching synced lyrics...');
        lyricsEntries = [];
        activeLyricsIndex = -1;
        renderLyrics([], '');

        const pendingLyricsSources = new Map([
            ['navidrome', fetchNavidromeLyrics(songData, lyricsAbortController.signal)
                .then((lyrics) => ({ source: 'navidrome', lyrics }))
                .catch((error) => ({ source: 'navidrome', error }))],
            ['lrclib', fetchLrclibLyrics(songData, lyricsAbortController.signal)
                .then((lyrics) => ({ source: 'lrclib', lyrics }))
                .catch((error) => ({ source: 'lrclib', error }))],
        ]);
        let plainLyricsCandidate = null;

        while (pendingLyricsSources.size) {
            const result = await Promise.race([...pendingLyricsSources.values()]);
            pendingLyricsSources.delete(result.source);

            if (result.error?.name === 'AbortError') {
                throw result.error;
            }

            if (fetchToken !== lyricsFetchToken) {
                return;
            }

            const syncedEntries = parseSyncedLyrics(result.lyrics?.syncedLyrics || '');
            if (syncedEntries.length) {
                lyricsEntries = syncedEntries;
                renderLyrics(lyricsEntries, result.lyrics.plainLyrics || '', { delayShrink: true });
                lastLyricsKey = lyricsKey;
                setLyricsStatus(`synced from ${result.source}`);
                syncLyricsToPosition(songData.position);
                return;
            }

            if (result.lyrics?.plainLyrics) {
                plainLyricsCandidate = result;
                lyricsEntries = [];
                renderLyrics([], result.lyrics.plainLyrics, { delayShrink: true });
                setLyricsStatus(`plain lyrics from ${result.source}${pendingLyricsSources.size ? ', checking synced lyrics...' : ''}`);
            }
        }

        if (plainLyricsCandidate) {
            lastLyricsKey = lyricsKey;
            setLyricsStatus(`plain lyrics from ${plainLyricsCandidate.source}`);
            return;
        }

        throw new Error('lyrics not found');
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }

        if (fetchToken === lyricsFetchToken) {
            lastLyricsKey = lyricsKey;
            renderLyrics([], '', { delayShrink: true });
            setLyricsStatus('lyrics not found');
        }
    } finally {
        if (fetchToken === lyricsFetchToken) {
            isFetchingLyrics = false;
            if (pendingLyricsRefresh) {
                pendingLyricsRefresh = false;
                if (lyricsDrawer?.classList.contains('open')) {
                    fetchLyrics(true);
                }
            }
        }
    }
};

const formatCoverIdentity = (data, fallbackTrackId) => {
    const album = String(data.album || '').trim().toLowerCase();
    const artist = String(data.artist || '').trim().toLowerCase();

    if (album) {
        return `album:${album}`;
    }

    if (artist) {
        return `artist:${artist}`;
    }

    return data.artUrl || fallbackTrackId;
};

const getCoverBackgroundIdentity = (data = {}, coverUrl = '') => {
    const album = String(data.album || '').trim().toLowerCase();

    if (album) {
        return `album:${album}`;
    }

    const artist = String(data.artist || '').trim().toLowerCase();
    const title = String(data.title || '').trim().toLowerCase();

    return artist || title ? `track:${artist}:${title}` : `cover:${coverUrl}`;
};

const getCoverBackgroundSize = () => (
    localStorage.getItem(HIGH_RES_BACKGROUND_STORAGE_KEY) === 'true' ? 1600 : 1024
);

const getStableCoverBackgroundUrl = (coverUrl) => {
    if (!coverUrl) {
        return '';
    }

    try {
        const url = new URL(coverUrl, window.location.origin);

        if (url.pathname === '/navidrome/cover' && url.searchParams.get('coverArt')) {
            url.searchParams.delete('id');
            url.searchParams.delete('art');
            url.searchParams.set('size', String(getCoverBackgroundSize()));
        }

        return url.pathname === '/mpris/art'
            ? `${url.pathname}${url.search}`
            : url.toString();
    } catch {
        return coverUrl;
    }
};

const preloadCoverBackgroundHint = (hint = {}) => {
    if (!coverBackgroundEnabled) {
        return '';
    }

    try {
        const hintedCoverUrl = hint.coverUrl || hint.artUrl || '';
        const backgroundCoverUrl = getStableCoverBackgroundUrl(hintedCoverUrl);

        if (!backgroundCoverUrl || backgroundCoverUrl === appliedCoverBackgroundUrl || hintedCoverBackgrounds.has(backgroundCoverUrl)) {
            return backgroundCoverUrl;
        }

        const preload = new Image();
        const cleanup = () => window.setTimeout(() => hintedCoverBackgrounds.delete(backgroundCoverUrl), 15000);
        hintedCoverBackgrounds.set(backgroundCoverUrl, preload);
        preload.onload = cleanup;
        preload.onerror = cleanup;
        preload.src = backgroundCoverUrl;
        preload.decode?.().then(cleanup).catch(cleanup);
        return backgroundCoverUrl;
    } catch {
        return '';
    }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const getSavedLastSong = () => {
    try {
        return JSON.parse(localStorage.getItem(LAST_SONG_STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
};
const saveLastSong = (data = {}) => {
    if (!(data.title || data.artist || data.album)) {
        return;
    }

    const nextTrackId = data.trackId || [data.title, data.artist, data.album, data.duration].join('|');
    localStorage.setItem(LAST_SONG_STORAGE_KEY, JSON.stringify({
        source: data.source || playerSource,
        title: data.title || '',
        artist: data.artist || '',
        album: data.album || '',
        coverUrl: data.coverUrl || data.artUrl || '',
        position: Number.isFinite(Number(data.position)) ? Number(data.position) : 0,
        duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
        trackId: nextTrackId,
        savedAt: Date.now(),
    }));
};
const getStoredVolume = () => {
    const stored = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY));
    return Number.isFinite(stored) ? clamp(stored, 0, 1) : 0.82;
};
const setVolumeSlider = (volume, persist = false) => {
    if (!playerVolumeSlider || !Number.isFinite(volume)) {
        return;
    }

    const safeVolume = clamp(volume, 0, 1);
    const percent = Math.round(safeVolume * 100);
    playerVolumeSlider.value = String(percent);
    playerVolumeSlider.style.setProperty('--progress', `${percent}%`);
    playerVolumeSlider.setAttribute('aria-valuetext', `${percent}%`);
    if (playerVolumeValue) {
        playerVolumeValue.textContent = `${percent}%`;
    }

    if (persist) {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(safeVolume));
    }
};
const mixColor = (color, target, amount) => color.map((channel, index) => Math.round(channel + (target[index] - channel) * amount));
const colorToRgb = (color) => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
const colorToRgba = (color, alpha) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
const rgbToHsl = ([red, green, blue]) => {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;

    if (!delta) {
        return { hue: 0, saturation: 0, lightness };
    }

    const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
    let hue;

    if (max === r) {
        hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
        hue = 60 * (((b - r) / delta) + 2);
    } else {
        hue = 60 * (((r - g) / delta) + 4);
    }

    return {
        hue: hue < 0 ? hue + 360 : hue,
        saturation,
        lightness,
    };
};
const getHuePreference = (hue) => {
    if (hue >= 300 || hue <= 30) return 1.32;
    if (hue > 30 && hue <= 70) return 1.14;
    if (hue >= 170 && hue <= 245) return 0.78;
    if (hue > 245 && hue < 300) return 0.94;
    return 1;
};

const getLuminance = (color) => {
    const [red, green, blue] = color.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });

    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};

const setCoverThemeToggle = () => {
    if (!coverThemeToggle) {
        return;
    }

    coverThemeToggle.textContent = adaptiveCoverColorsEnabled ? 'on' : 'off';
    coverThemeToggle.classList.toggle('is-on', adaptiveCoverColorsEnabled);
    coverThemeToggle.setAttribute('aria-pressed', adaptiveCoverColorsEnabled);
};

const resetCoverColors = () => {
    Object.entries(defaultTheme).forEach(([property, value]) => {
        root.style.setProperty(property, value);
    });
};

const resetCoverBackground = (disableBackground = false) => {
    if (disableBackground) {
        coverBackgroundEnabled = false;
    }

    document.body.classList.remove('has-cover-theme');
    root.classList.remove('has-cover-theme');
    coverBackgroundRun += 1;
    appliedCoverBackgroundUrl = '';
    appliedCoverBackgroundIdentity = '';
    root.style.setProperty('--cover-bg-opacity', '0');
    root.style.setProperty('--cover-bg-scale', '1.035');
    window.setTimeout(() => {
        if (!coverBackgroundEnabled) {
            root.style.removeProperty('--cover-bg');
        }
    }, 900);
    root.style.removeProperty('--cover-readable-overlay');
    localStorage.removeItem(COVER_BACKGROUND_STORAGE_KEY);
    resetCoverColors();
};

const readCoverColorStats = () => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const size = 48;

    canvas.width = size;
    canvas.height = size;
    context.drawImage(nowPlayingCover, 0, 0, size, size);

    const { data } = context.getImageData(0, 0, size, size);
    const average = [0, 0, 0];
    const hueBins = Array.from({ length: 36 }, () => ({ red: 0, green: 0, blue: 0, score: 0, count: 0 }));
    let count = 0;

    for (let index = 0; index < data.length; index += 16) {
        const alpha = data[index + 3];

        if (alpha < 32) {
            continue;
        }

        const color = [data[index], data[index + 1], data[index + 2]];
        average[0] += color[0];
        average[1] += color[1];
        average[2] += color[2];
        count += 1;

        const { hue, saturation, lightness } = rgbToHsl(color);
        if (saturation < 0.18 || lightness < 0.12 || lightness > 0.94) {
            continue;
        }

        const bin = hueBins[Math.min(hueBins.length - 1, Math.floor(hue / 10))];
        const lightnessWeight = 1 - (Math.abs(lightness - 0.52) * 0.72);
        const score = (saturation ** 1.35) * Math.max(0.2, lightnessWeight);
        bin.red += color[0] * score;
        bin.green += color[1] * score;
        bin.blue += color[2] * score;
        bin.score += score;
        bin.count += 1;
    }

    const averaged = count ? average.map((channel) => Math.round(channel / count)) : [116, 198, 157];
    let bestIndex = -1;
    let bestScore = 0;

    hueBins.forEach((bin, index) => {
        const previous = hueBins[(index - 1 + hueBins.length) % hueBins.length];
        const next = hueBins[(index + 1) % hueBins.length];
        const clusterScore = bin.score + (previous.score * 0.62) + (next.score * 0.62);
        const clusterCount = bin.count + (previous.count * 0.62) + (next.count * 0.62);
        const hue = index * 10;
        const score = clusterScore * (Math.max(1, clusterCount) ** 0.26) * getHuePreference(hue);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });

    if (bestIndex < 0 || bestScore < 0.5) {
        return { average: averaged, accent: averaged };
    }

    const selectedBins = [
        hueBins[(bestIndex - 1 + hueBins.length) % hueBins.length],
        hueBins[bestIndex],
        hueBins[(bestIndex + 1) % hueBins.length],
    ];
    const accentTotals = selectedBins.reduce((totals, bin) => ({
        red: totals.red + bin.red,
        green: totals.green + bin.green,
        blue: totals.blue + bin.blue,
        score: totals.score + bin.score,
    }), { red: 0, green: 0, blue: 0, score: 0 });
    const accent = accentTotals.score
        ? [
            Math.round(accentTotals.red / accentTotals.score),
            Math.round(accentTotals.green / accentTotals.score),
            Math.round(accentTotals.blue / accentTotals.score),
        ]
        : averaged;

    return { average: averaged, accent };
};

const applyAdaptiveCoverColors = () => {
    if (!adaptiveCoverColorsEnabled || !coverBackgroundEnabled || !currentCoverUrl || !nowPlayingCover.complete) {
        resetCoverColors();
        return;
    }

    try {
        const { average, accent } = readCoverColorStats();
        const base = accent || average;
        const isDark = getLuminance(base) < 0.42;
        const text = isDark ? mixColor(base, [245, 255, 245], 0.9) : mixColor(base, [0, 35, 10], 0.82);
        const shadow = isDark ? mixColor(base, [0, 0, 0], 0.72) : mixColor(base, [0, 20, 8], 0.76);
        const surface = isDark ? mixColor(base, [0, 0, 0], 0.18) : mixColor(base, [255, 255, 255], 0.44);
        const surfaceHover = isDark ? mixColor(base, [255, 255, 255], 0.16) : mixColor(base, [255, 255, 255], 0.62);
        const input = isDark ? mixColor(base, [0, 0, 0], 0.04) : mixColor(base, [255, 255, 255], 0.8);
        const onInput = getLuminance(input) < 0.42 ? [245, 255, 245] : [0, 35, 10];

        const colors = {
            '--color-page-bg': colorToRgb(base),
            '--color-text': colorToRgb(text),
            '--color-shadow': colorToRgb(shadow),
            '--color-surface': colorToRgb(surface),
            '--color-surface-hover': colorToRgb(surfaceHover),
            '--color-input-bg': colorToRgb(input),
            '--color-on-input': colorToRgb(onInput),
            '--color-disc-line': colorToRgba(shadow, 0.26),
        };

        Object.entries(colors).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });

        const cachedBackground = JSON.parse(localStorage.getItem(COVER_BACKGROUND_STORAGE_KEY) || 'null');
        if (cachedBackground?.url) {
            localStorage.setItem(COVER_BACKGROUND_STORAGE_KEY, JSON.stringify({
                ...cachedBackground,
                colors,
                pageBg: colors['--color-page-bg'],
            }));
        }
    } catch {
        resetCoverColors();
    }
};

const crossfadeCoverBackground = (nextCoverUrl, run = coverBackgroundRun) => {
    const previousCoverUrl = appliedCoverBackgroundUrl;

    if (previousCoverUrl === nextCoverUrl) {
        root.style.setProperty('--cover-bg-opacity', '1');
        root.style.setProperty('--cover-bg-scale', '1');
        return;
    }

    const revealNextCover = () => {
        if (run !== coverBackgroundRun || (currentCoverUrl && getStableCoverBackgroundUrl(currentCoverUrl) !== nextCoverUrl)) {
            return;
        }

        if (previousCoverUrl) {
            const outgoing = document.createElement('img');
            outgoing.className = 'cover-theme-crossfade';
            outgoing.src = previousCoverUrl;
            document.body.append(outgoing);

            outgoing.animate([
                { opacity: 1, transform: 'scale(1)', filter: 'saturate(1) brightness(1)' },
                { opacity: 0, transform: 'scale(1.035)', filter: 'saturate(0.92) brightness(0.94)' },
            ], {
                duration: 1100,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'forwards',
            }).onfinish = () => outgoing.remove();
        }

        root.style.setProperty('--cover-bg-opacity', '0');
        root.style.setProperty('--cover-bg-scale', '1.045');
        root.style.setProperty('--cover-bg', `url("${nextCoverUrl}")`);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                root.style.setProperty('--cover-bg-opacity', '1');
                root.style.setProperty('--cover-bg-scale', '1');
            });
        });

        appliedCoverBackgroundUrl = nextCoverUrl;
    };

    const preload = new Image();
    let revealed = false;
    const safeReveal = () => {
        if (revealed || run !== coverBackgroundRun) {
            return;
        }

        revealed = true;
        revealNextCover();
    };

    preload.onload = safeReveal;
    preload.onerror = () => {
        revealed = true;
    };
    preload.src = nextCoverUrl;
    preload.decode?.().then(safeReveal).catch(() => {});
};

const startCoverBackgroundPreload = () => {
    if (!coverBackgroundEnabled || !currentCoverUrl) {
        return;
    }

    try {
        const backgroundCoverUrl = getStableCoverBackgroundUrl(currentCoverUrl);
        const backgroundIdentity = getCoverBackgroundIdentity(currentSongData, currentCoverUrl);
        const isSameBackground = backgroundIdentity && backgroundIdentity === appliedCoverBackgroundIdentity;

        if (!isSameBackground) {
            const run = ++coverBackgroundRun;
            crossfadeCoverBackground(backgroundCoverUrl, run);
            appliedCoverBackgroundIdentity = backgroundIdentity;
        } else {
            root.style.setProperty('--cover-bg-opacity', '1');
            root.style.setProperty('--cover-bg-scale', '1');
        }

        root.classList.add('has-cover-theme');
        document.body.classList.add('has-cover-theme');

        const cachedBackground = JSON.parse(localStorage.getItem(COVER_BACKGROUND_STORAGE_KEY) || 'null') || {};
        localStorage.setItem(COVER_BACKGROUND_STORAGE_KEY, JSON.stringify({
            ...cachedBackground,
            url: isSameBackground ? appliedCoverBackgroundUrl || backgroundCoverUrl : backgroundCoverUrl,
            identity: backgroundIdentity,
        }));
    } catch {}
};

const applyCoverBackground = () => {
    if (!coverBackgroundEnabled || !currentCoverUrl || !nowPlayingCover.complete) {
        return;
    }

    try {
        const { average, accent } = readCoverColorStats();
        const base = accent || average;
        const isDark = getLuminance(base) < 0.42;
        const overlay = !adaptiveCoverColorsEnabled
            ? 'linear-gradient(rgba(116, 198, 157, 0.34), rgba(216, 243, 220, 0.44))'
            : isDark
                ? 'linear-gradient(rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.28))'
                : 'linear-gradient(rgba(0, 35, 10, 0.16), rgba(0, 35, 10, 0.22))';

        const backgroundCoverUrl = getStableCoverBackgroundUrl(currentCoverUrl);
        const backgroundIdentity = getCoverBackgroundIdentity(currentSongData, currentCoverUrl);
        const isSameBackground = backgroundIdentity && backgroundIdentity === appliedCoverBackgroundIdentity;

        if (!isSameBackground) {
            const run = ++coverBackgroundRun;
            crossfadeCoverBackground(backgroundCoverUrl, run);
            appliedCoverBackgroundIdentity = backgroundIdentity;
        } else {
            root.style.setProperty('--cover-bg-opacity', '1');
            root.style.setProperty('--cover-bg-scale', '1');
        }

        root.style.setProperty('--cover-readable-overlay', overlay);
        root.classList.add('has-cover-theme');
        document.body.classList.add('has-cover-theme');
        localStorage.setItem(COVER_BACKGROUND_STORAGE_KEY, JSON.stringify({
            url: isSameBackground && appliedCoverBackgroundUrl === backgroundCoverUrl ? appliedCoverBackgroundUrl : backgroundCoverUrl,
            identity: backgroundIdentity,
            overlay,
            pageBg: colorToRgb(base),
        }));
        applyAdaptiveCoverColors();
    } catch {
        resetCoverBackground(true);
    }
};

const setAdaptiveCoverColorsEnabled = (enabled) => {
    adaptiveCoverColorsEnabled = enabled;
    localStorage.setItem(ADAPTIVE_COLORS_STORAGE_KEY, String(enabled));
    setCoverThemeToggle();

    if (!enabled) {
        resetCoverColors();
        const cachedBackground = JSON.parse(localStorage.getItem(COVER_BACKGROUND_STORAGE_KEY) || 'null');
        if (cachedBackground?.url) {
            delete cachedBackground.colors;
            localStorage.setItem(COVER_BACKGROUND_STORAGE_KEY, JSON.stringify(cachedBackground));
        }
        if (coverBackgroundEnabled) {
            applyCoverBackground();
        }
        return;
    }

    if (coverBackgroundEnabled) {
        applyCoverBackground();
        return;
    }

    applyAdaptiveCoverColors();
};

const updateStatusPillWidth = () => {
    if (!nowPlayingStatusPill) {
        return;
    }

    root.style.setProperty('--status-pill-width', `${Math.ceil(nowPlayingStatusPill.offsetWidth)}px`);
};

const setProgressBubble = (seconds, percent, bubbleLeft = `${clamp(percent, 0, 100)}%`) => {
    if (!progressTimeBubble) {
        return;
    }

    progressTimeBubble.textContent = formatPlaybackTime(seconds);
    progressTimeBubble.style.setProperty('--bubble-left', bubbleLeft);
};

const setProgressSlider = (position, duration) => {
    if (!nowPlayingProgress || isScrubbingProgress) {
        return;
    }

    const hasDuration = Number.isFinite(duration) && duration > 0;
    const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
    const progressPercent = hasDuration ? Math.min(100, (safePosition / duration) * 100) : 0;

    currentDuration = hasDuration ? duration : 0;
    nowPlayingProgress.disabled = !hasDuration;
    nowPlayingProgress.max = hasDuration ? String(Math.floor(duration)) : '100';
    nowPlayingProgress.value = hasDuration ? String(Math.min(Math.floor(safePosition), Math.floor(duration))) : '0';
    nowPlayingProgress.style.setProperty('--progress', `${progressPercent}%`);
    setProgressBubble(safePosition, progressPercent);
};

const stopMarquee = (content) => {
    const state = marquees.get(content);
    clearTimeout(state?.timeout);
    state?.animation?.cancel();
    content.classList.remove('is-overflowing');
    content.style.transform = '';
    marquees.delete(content);
};

const stopAllMarquees = () => {
    titleMarqueeToken += 1;
    [nowPlayingTitle, nowPlayingArtist].forEach(stopMarquee);
};

const startMarquee = (line, content, token, pause = 2000) => {
    if (token !== titleMarqueeToken || !line || !content || !content.textContent.trim()) {
        return;
    }

    const overflowDistance = content.scrollWidth - line.clientWidth;

    if (overflowDistance <= 4) {
        stopMarquee(content);
        return;
    }

    const travelDistance = overflowDistance + 16;
    const endTransform = `translateX(-${travelDistance}px)`;
    const travelDuration = Math.max(1250, travelDistance * 23);
    const returnDuration = Math.max(420, travelDistance * 8);

    content.classList.add('is-overflowing');
    content.style.transform = 'translateX(0)';

    const timeout = setTimeout(() => {
        if (token !== titleMarqueeToken) {
            return;
        }

        const animation = content.animate([
            { transform: 'translateX(0)' },
            { transform: endTransform },
        ], {
            duration: travelDuration,
            easing: 'linear',
            fill: 'forwards',
        });

        marquees.set(content, { animation, timeout: null });

        animation.onfinish = () => {
            if (token !== titleMarqueeToken) {
                return;
            }

            animation.cancel();
            content.style.transform = endTransform;
            const returnAnimation = content.animate([
                { transform: endTransform },
                { transform: 'translateX(0)' },
            ], {
                duration: returnDuration,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'forwards',
            });

            marquees.set(content, { animation: returnAnimation, timeout: null });

            returnAnimation.onfinish = () => {
                if (token !== titleMarqueeToken) {
                    return;
                }

                returnAnimation.cancel();
                content.style.transform = 'translateX(0)';
                marquees.delete(content);
                requestAnimationFrame(() => startMarquee(line, content, token, pause));
            };
        };
    }, pause);

    marquees.set(content, { animation: null, timeout });
};

const queueNowPlayingMarquees = () => {
    stopAllMarquees();
    const token = titleMarqueeToken;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            startMarquee(nowPlayingTitleLine, nowPlayingTitle, token);
            startMarquee(nowPlayingArtistLine, nowPlayingArtist, token, 2300);
        });
    });
};

const setPlaybackState = (state) => {
    playbackState = normalizePlaybackState(state);
    nowPlayingBar.classList.toggle('is-paused', playbackState !== 'playing');

    if (playPauseControl) {
        playPauseControl.textContent = playbackState === 'playing' ? 'pause' : 'play';
        playPauseControl.classList.toggle('is-active-state', playbackState === 'playing');
        playPauseControl.setAttribute('aria-label', playbackState === 'playing' ? 'pause playback' : 'play playback');
        playPauseControl.setAttribute('aria-pressed', playbackState === 'playing');
    }
};

const setNowPlayingText = (title, state = 'empty', coverUrl = '', meta = {}) => {
    nowPlayingTitle.textContent = title;
    nowPlayingAlbum.textContent = meta.album || '';
    nowPlayingArtist.textContent = meta.artist || '';

    currentCoverUrl = coverUrl;

    if (coverUrl) {
        if (nowPlayingCover.getAttribute('src') !== coverUrl) {
            nowPlayingCover.src = coverUrl;
        }
    } else if (!appliedCoverBackgroundUrl) {
        nowPlayingCover.removeAttribute('src');
    }

    nowPlayingCover.classList.toggle('has-cover', Boolean(coverUrl));
    coverThemeButton?.classList.toggle('has-cover', Boolean(coverUrl));
    coverThemeButton?.toggleAttribute('disabled', !coverUrl);

    if (coverUrl && coverBackgroundEnabled) {
        startCoverBackgroundPreload();
        requestAnimationFrame(applyCoverBackground);
    }

    nowPlayingBar.classList.remove('is-playing', 'is-empty');
    nowPlayingBar.classList.add(`is-${state}`);
    queueNowPlayingMarquees();
};

const showSavedLastSong = (statusText = 'last played') => {
    const saved = getSavedLastSong();

    if (!(saved?.title || saved?.artist || saved?.album)) {
        return false;
    }

    const nextTrackId = saved.trackId || [saved.title, saved.artist, saved.album, saved.duration].join('|');
    const coverIdentity = formatCoverIdentity(saved, nextTrackId);
    const coverSeparator = saved.coverUrl?.includes('?') ? '&' : '?';
    const coverUrl = saved.coverUrl ? `${saved.coverUrl}${coverSeparator}art=${encodeURIComponent(coverIdentity)}` : '';

    currentSongData = { ...saved, status: 'stopped' };
    setPlaybackState('stopped');
    nowPlayingTimer.textContent = statusText;
    updateStatusPillWidth();
    setProgressSlider(saved.position, saved.duration);
    setNowPlayingText(saved.title || 'unknown song', 'playing', coverUrl, formatSongMeta(saved.album, saved.artist));
    lastTrackId = nextTrackId;
    lastCoverUrl = coverUrl;
    resetLyricsState('tap the card to fetch lyrics', { delayShrink: true });
    return true;
};

const setPlayerSong = (data) => {
    const state = normalizePlaybackState(data.status);
    const hasSong = Boolean(data.title || data.artist || data.album);
    const incomingSource = data.source || playerSource;
    const sourceChanged = incomingSource !== renderedPlayerSource;
    const shouldForceRender = forceNextPlayerRender || sourceChanged;

    forceNextPlayerRender = false;
    renderedPlayerSource = incomingSource;
    currentSongData = data;
    if (Number.isFinite(Number(data.volume))) {
        setVolumeSlider(Number(data.volume), true);
    }
    setPlaybackState(state);
    nowPlayingTimer.textContent = `${formatPlaybackTime(data.position)} / ${formatPlaybackTime(data.duration)}`;
    updateStatusPillWidth();
    setProgressSlider(data.position, data.duration);

    if (hasSong) {
        saveLastSong(data);
    }

    const nextTrackId = data.trackId || [data.title, data.artist, data.album, data.duration].join('|');
    const coverIdentity = formatCoverIdentity(data, nextTrackId);
    const coverSeparator = data.coverUrl?.includes('?') ? '&' : '?';
    const coverUrl = data.coverUrl ? `${data.coverUrl}${coverSeparator}art=${encodeURIComponent(coverIdentity)}` : '';

    if (hasSong && state === 'stopped') {
        if ((shouldForceRender || nextTrackId !== lastTrackId || coverUrl !== lastCoverUrl) && coverUrl) {
            setNowPlayingText(
                data.title || 'unknown song',
                'playing',
                coverUrl,
                formatSongMeta(data.album, data.artist),
            );
            lastTrackId = nextTrackId;
            lastCoverUrl = coverUrl;
        }
        syncLyricsToPosition(data.position || data.duration || 0);
        return;
    }

    if (!hasSong) {
        if (showSavedLastSong(isMprisSource() ? 'mpris stopped' : 'last played')) {
            return;
        }

        nowPlayingTimer.textContent = isMprisSource() ? 'mpris stopped' : 'choose an album or artist';
        updateStatusPillWidth();
        resetLyricsState('tap the card to fetch lyrics', { delayShrink: true });
        lastTrackId = '';
        lastCoverUrl = '';
        setProgressSlider(null, null);
        setNowPlayingText('nothing playing', 'empty');
        return;
    }

    if (shouldForceRender || nextTrackId !== lastTrackId || coverUrl !== lastCoverUrl) {
        setNowPlayingText(
            data.title || 'unknown song',
            'playing',
            coverUrl,
            formatSongMeta(data.album, data.artist),
        );
        lastTrackId = nextTrackId;
        lastCoverUrl = coverUrl;

        fetchLyrics(true);
    } else {
        syncLyricsToPosition(data.position);
    }
};

const fetchMprisSong = async ({ force = false } = {}) => {
    if (!isMprisSource()) {
        return;
    }

    if (isFetchingMpris) {
        pendingForcedMprisRefresh = pendingForcedMprisRefresh || force;
        return;
    }

    const run = ++mprisFetchRun;

    try {
        isFetchingMpris = true;
        const response = await fetch(MPRIS_URL, { cache: 'no-store' });

        if (!response.ok) {
            throw new Error('mpris unavailable');
        }

        if (run !== mprisFetchRun || !isMprisSource()) {
            return;
        }

        if (force) {
            forceNextPlayerRender = true;
        }

        setPlayerSong({ ...await response.json(), source: 'mpris' });
    } catch {
        if (run !== mprisFetchRun || !isMprisSource()) {
            return;
        }

        if (!showSavedLastSong('mpris unavailable')) {
            setPlaybackState('stopped');
            nowPlayingTimer.textContent = 'mpris unavailable';
            updateStatusPillWidth();
            setProgressSlider(null, null);
            setNowPlayingText('nothing playing', 'empty');
        }
    } finally {
        isFetchingMpris = false;

        if (pendingForcedMprisRefresh && isMprisSource()) {
            pendingForcedMprisRefresh = false;
            fetchMprisSong({ force: true });
        }
    }
};

const sendMprisControl = async (action, params = {}) => {
    try {
        const controlUrl = new URL(MPRIS_CONTROL_URL, window.location.origin);
        controlUrl.searchParams.set('action', action);

        Object.entries(params).forEach(([key, value]) => {
            controlUrl.searchParams.set(key, value);
        });

        await fetch(controlUrl.toString(), { cache: 'no-store' });
        fetchMprisSong();
    } catch {
        nowPlayingTimer.textContent = 'mpris control failed';
    }
};

const sendPlayerControl = (action, params = {}) => {
    if (isMprisSource()) {
        sendMprisControl(action, params);
        return;
    }

    window.spinachPlayer?.control?.(action, params);
};

const sendPlayerVolume = (volume, immediate = false) => {
    const safeVolume = clamp(volume, 0, 1);
    setVolumeSlider(safeVolume, true);

    if (!isMprisSource()) {
        window.spinachPlayer?.control?.('volume', { volume: String(safeVolume) });
        return;
    }

    clearTimeout(mprisVolumeTimer);
    const send = () => sendMprisControl('volume', { volume: String(safeVolume) });

    if (immediate) {
        send();
        return;
    }

    mprisVolumeTimer = setTimeout(send, 90);
};

playerControls.forEach((control) => {
    control.addEventListener('click', () => {
        sendPlayerControl(control.dataset.mprisAction);
    });
});

if (playerVolumeSlider) {
    setVolumeSlider(getStoredVolume());

    playerVolumeSlider.addEventListener('input', () => {
        sendPlayerVolume((Number.parseFloat(playerVolumeSlider.value) || 0) / 100);
    });

    playerVolumeSlider.addEventListener('change', () => {
        sendPlayerVolume((Number.parseFloat(playerVolumeSlider.value) || 0) / 100, true);
    });
}

if (nowPlayingProgress) {
    const updateProgressPreview = (clientX) => {
        const duration = currentDuration || Number.parseFloat(nowPlayingProgress.max) || 0;

        if (!duration || nowPlayingProgress.disabled) {
            setProgressBubble(0, 0);
            return;
        }

        const rect = nowPlayingProgress.getBoundingClientRect();
        const pillRect = nowPlayingProgress.parentElement.getBoundingClientRect();
        const percent = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
        const bubbleLeft = `${clamp(clientX - pillRect.left, 0, pillRect.width)}px`;
        const seconds = (percent / 100) * duration;

        setProgressBubble(seconds, percent, bubbleLeft);
    };

    nowPlayingProgress.addEventListener('pointermove', (event) => {
        updateProgressPreview(event.clientX);
    });

    nowPlayingProgress.addEventListener('input', () => {
        isScrubbingProgress = true;
        const max = Number.parseFloat(nowPlayingProgress.max) || 0;
        const value = Number.parseFloat(nowPlayingProgress.value) || 0;
        const progressPercent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
        nowPlayingProgress.style.setProperty('--progress', `${progressPercent}%`);
        setProgressBubble(value, progressPercent);
    });

    nowPlayingProgress.addEventListener('change', () => {
        const position = Number.parseFloat(nowPlayingProgress.value) || 0;
        isScrubbingProgress = false;
        sendPlayerControl('seek', { position: String(position) });
    });
}

coverThemeButton?.addEventListener('click', () => {
    if (!currentCoverUrl) {
        return;
    }

    if (coverBackgroundEnabled) {
        resetCoverBackground(true);
        return;
    }

    coverBackgroundEnabled = true;
    applyCoverBackground();
});

coverThemeToggle?.addEventListener('click', () => {
    setAdaptiveCoverColorsEnabled(!adaptiveCoverColorsEnabled);
});

const openLyricsDrawer = () => {
    lyricsDrawer?.classList.add('open');
    lyricsDrawer?.setAttribute('aria-hidden', 'false');
    lyricsTab?.setAttribute('aria-expanded', 'true');
    fetchLyrics();
};

const closeLyricsDrawer = () => {
    lyricsDrawer?.classList.remove('open');
    lyricsDrawer?.setAttribute('aria-hidden', 'true');
    lyricsTab?.setAttribute('aria-expanded', 'false');
};

lyricsTab?.addEventListener('click', () => {
    if (lyricsDrawer?.classList.contains('open')) {
        closeLyricsDrawer();
        return;
    }

    openLyricsDrawer();
});

lyricsClose?.addEventListener('click', closeLyricsDrawer);

lyricsLines?.addEventListener('click', (event) => {
    const line = event.target.closest('.lyrics-line[data-time]');
    if (!line) {
        return;
    }

    const position = Number.parseFloat(line.dataset.time);
    if (!Number.isFinite(position)) {
        return;
    }

    sendPlayerControl('seek', { position: String(position) });
    syncLyricsToPosition(position);
});

nowPlayingCover.addEventListener('load', () => {
    if (coverBackgroundEnabled) {
        applyCoverBackground();
    }
});

nowPlayingCover.addEventListener('error', () => {
    if (currentCoverUrl && coverBackgroundEnabled) {
        startCoverBackgroundPreload();
    }
    resetCoverColors();
});

window.addEventListener('spinach:advanced-settings-changed', (event) => {
    if (event.detail?.setting !== 'backgroundCovers' || !currentCoverUrl || !coverBackgroundEnabled) {
        return;
    }

    appliedCoverBackgroundIdentity = '';
    startCoverBackgroundPreload();
    applyCoverBackground();
});

window.addEventListener('spinach:cache-cleared', (event) => {
    if (event.detail?.cache !== 'palettes' || !coverBackgroundEnabled || !currentCoverUrl) {
        return;
    }

    applyAdaptiveCoverColors();
});

window.addEventListener('resize', () => {
    queueNowPlayingMarquees();
    updateStatusPillWidth();
});

const stopMprisPolling = () => {
    clearInterval(mprisPollTimer);
    mprisPollTimer = null;
    pendingForcedMprisRefresh = false;
    mprisFetchRun += 1;
};

const startMprisPolling = ({ force = false } = {}) => {
    fetchMprisSong({ force });

    if (mprisPollTimer) {
        return;
    }

    mprisPollTimer = setInterval(fetchMprisSong, MPRIS_POLL_INTERVAL);
};

const showBrowserPlayerIdle = () => {
    const state = window.spinachPlayer?.getState?.();
    if (state?.title || state?.artist || state?.album) {
        setPlayerSong(state);
        return;
    }

    if (!showSavedLastSong('last played')) {
        setPlaybackState('stopped');
        nowPlayingTimer.textContent = 'navidrome player';
        updateStatusPillWidth();
        setProgressSlider(null, null);
        setNowPlayingText('nothing playing', 'empty');
    }
};

const refreshPlayerSource = () => {
    const previousSource = playerSource;
    playerSource = getPlayerSource();
    forceNextPlayerRender = true;
    lastTrackId = '';
    lastCoverUrl = '';

    if (previousSource !== playerSource) {
        resetLyricsState('tap the card to fetch lyrics');
    }

    if (isMprisSource()) {
        startMprisPolling({ force: previousSource !== playerSource });
        return;
    }

    stopMprisPolling();
    sendPlayerVolume(getStoredVolume(), true);
    showBrowserPlayerIdle();
};

window.addEventListener('spinach:player-state', (event) => {
    if (!isMprisSource()) {
        setPlayerSong(event.detail || {});
    }
});

window.addEventListener('spinach:player-message', (event) => {
    if (!isMprisSource() && event.detail?.message) {
        nowPlayingTimer.textContent = event.detail.message;
        updateStatusPillWidth();
    }
});

window.addEventListener('spinach:player-source-change', refreshPlayerSource);

window.spinachNowPlaying = {
    ...(window.spinachNowPlaying || {}),
    preloadCoverBackground: preloadCoverBackgroundHint,
};

setCoverThemeToggle();
updateStatusPillWidth();
setPlaybackState(playbackState);
refreshPlayerSource();
})();
