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
const progressTimeBubble = document.querySelector('#progress-time-bubble');
const nowPlayingTitleLine = document.querySelector('.now-playing-title-line');
const nowPlayingArtistLine = document.querySelector('.now-playing-artist-line');
const playerControls = document.querySelectorAll('.player-control');
const playPauseControl = document.querySelector('[data-mpris-action="toggle"]');
const coverThemeToggle = document.querySelector('#cover-theme-toggle');
const lyricsDrawer = document.querySelector('.lyrics-drawer');
const lyricsTab = document.querySelector('.lyrics-tab');
const lyricsClose = document.querySelector('.lyrics-close');
const lyricsStatus = document.querySelector('#lyrics-status');
const lyricsLines = document.querySelector('#lyrics-lines');

const MPRIS_URL = '/mpris';
const MPRIS_CONTROL_URL = '/mpris/control';
const LYRICS_URL = '/lyrics';
const MPRIS_POLL_INTERVAL = 1000;
const ADAPTIVE_COLORS_STORAGE_KEY = 'spinachMusic.adaptiveCoverColors';
const COVER_BACKGROUND_STORAGE_KEY = 'spinachMusic.coverBackground';
const NAVIDROME_STORAGE_KEY = 'spinachMusic.navidromeConnection';
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
let lastTrackId = '';
let lastCoverUrl = '';
const marquees = new Map();
let titleMarqueeToken = 0;
let isScrubbingProgress = false;
let currentDuration = 0;
let currentCoverUrl = '';
let appliedCoverBackgroundUrl = '';
let currentSongData = null;
let lastLyricsKey = '';
let lyricsEntries = [];
let activeLyricsIndex = -1;
let isFetchingLyrics = false;
let pendingLyricsRefresh = false;
let lyricsFetchToken = 0;

try {
    appliedCoverBackgroundUrl = JSON.parse(localStorage.getItem(COVER_BACKGROUND_STORAGE_KEY) || 'null')?.url || '';
} catch {}

let coverBackgroundEnabled = true;
let adaptiveCoverColorsEnabled = localStorage.getItem(ADAPTIVE_COLORS_STORAGE_KEY) !== 'false';

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

const fetchNavidromeLyrics = async () => {
    const connection = loadNavidromeConnection();

    if (!connection?.url || !connection?.username || !connection?.password || !currentSongData?.title) {
        throw new Error('no navidrome connection');
    }

    const url = new URL('/navidrome/lyrics', window.location.origin);
    url.searchParams.set('url', connection.url);
    url.searchParams.set('username', connection.username);
    url.searchParams.set('password', connection.password);
    url.searchParams.set('title', currentSongData.title);
    url.searchParams.set('artist', currentSongData.artist || '');
    url.searchParams.set('album', currentSongData.album || '');
    url.searchParams.set('duration', String(currentSongData.duration || ''));

    const response = await fetch(url.toString(), { cache: 'no-store' });
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload?.error || 'navidrome lyrics not found');
    }

    return payload;
};

const fetchLrclibLyrics = async () => {
    const url = new URL(LYRICS_URL, window.location.origin);
    url.searchParams.set('title', currentSongData.title);
    url.searchParams.set('artist', currentSongData.artist);
    url.searchParams.set('album', currentSongData.album || '');
    url.searchParams.set('duration', String(currentSongData.duration || ''));

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('lyrics not found');
    }

    return {
        ...await response.json(),
        source: 'lrclib',
    };
};

const setLyricsStatus = (message) => {
    if (lyricsStatus) {
        lyricsStatus.textContent = message;
    }
};

const renderLyrics = (entries, plainLyrics = '') => {
    if (!lyricsLines) {
        return;
    }

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
    if (!currentSongData?.title || !currentSongData?.artist) {
        setLyricsStatus('no song info yet');
        return;
    }

    if (isFetchingLyrics) {
        pendingLyricsRefresh = true;
        return;
    }

    const lyricsKey = formatLyricsKey(currentSongData);
    if (!force && lyricsKey === lastLyricsKey && lyricsEntries.length) {
        syncLyricsToPosition(currentSongData.position);
        return;
    }

    const fetchToken = ++lyricsFetchToken;

    try {
        isFetchingLyrics = true;
        setLyricsStatus('fetching synced lyrics...');
        lyricsEntries = [];
        activeLyricsIndex = -1;
        renderLyrics([]);

        const navidromeLyrics = await fetchNavidromeLyrics().catch(() => null);
        if (fetchToken !== lyricsFetchToken) {
            return;
        }

        const navidromeSynced = parseSyncedLyrics(navidromeLyrics?.syncedLyrics || '');
        if (navidromeSynced.length) {
            lyricsEntries = navidromeSynced;
            renderLyrics(lyricsEntries, navidromeLyrics.plainLyrics || '');
            lastLyricsKey = lyricsKey;
            setLyricsStatus('synced from navidrome');
            syncLyricsToPosition(currentSongData.position);
            return;
        }

        if (navidromeLyrics?.plainLyrics) {
            renderLyrics([], navidromeLyrics.plainLyrics || '');
            setLyricsStatus('plain lyrics from navidrome, checking synced lyrics...');
        }

        const lrclibLyrics = await fetchLrclibLyrics().catch(() => null);
        if (fetchToken !== lyricsFetchToken) {
            return;
        }

        const lrclibSynced = parseSyncedLyrics(lrclibLyrics?.syncedLyrics || '');
        if (lrclibSynced.length) {
            lyricsEntries = lrclibSynced;
            renderLyrics(lyricsEntries, lrclibLyrics.plainLyrics || '');
            lastLyricsKey = lyricsKey;
            setLyricsStatus('synced from lrclib');
            syncLyricsToPosition(currentSongData.position);
            return;
        }

        if (lrclibLyrics) {
            lyricsEntries = [];
            renderLyrics([], lrclibLyrics.plainLyrics || '');
            lastLyricsKey = lyricsKey;
            setLyricsStatus('plain lyrics from lrclib');
            return;
        }

        if (!navidromeLyrics?.plainLyrics) {
            throw new Error('lyrics not found');
        }

        lastLyricsKey = lyricsKey;
        setLyricsStatus('lyrics not found');
    } catch {
        if (fetchToken === lyricsFetchToken) {
            lastLyricsKey = lyricsKey;
            renderLyrics([]);
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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mixColor = (color, target, amount) => color.map((channel, index) => Math.round(channel + (target[index] - channel) * amount));
const colorToRgb = (color) => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
const colorToRgba = (color, alpha) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
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
    appliedCoverBackgroundUrl = '';
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

const readCoverColor = () => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const size = 48;

    canvas.width = size;
    canvas.height = size;
    context.drawImage(nowPlayingCover, 0, 0, size, size);

    const { data } = context.getImageData(0, 0, size, size);
    const color = [0, 0, 0];
    let count = 0;

    for (let index = 0; index < data.length; index += 16) {
        const alpha = data[index + 3];

        if (alpha < 32) {
            continue;
        }

        color[0] += data[index];
        color[1] += data[index + 1];
        color[2] += data[index + 2];
        count += 1;
    }

    return count ? color.map((channel) => Math.round(channel / count)) : [116, 198, 157];
};

const applyAdaptiveCoverColors = () => {
    if (!adaptiveCoverColorsEnabled || !coverBackgroundEnabled || !currentCoverUrl || !nowPlayingCover.complete) {
        resetCoverColors();
        return;
    }

    try {
        const average = readCoverColor();
        const isDark = getLuminance(average) < 0.42;
        const text = isDark ? mixColor(average, [245, 255, 245], 0.9) : mixColor(average, [0, 35, 10], 0.82);
        const shadow = isDark ? mixColor(average, [0, 0, 0], 0.72) : mixColor(average, [0, 20, 8], 0.76);
        const surface = isDark ? mixColor(average, [0, 0, 0], 0.18) : mixColor(average, [255, 255, 255], 0.44);
        const surfaceHover = isDark ? mixColor(average, [255, 255, 255], 0.16) : mixColor(average, [255, 255, 255], 0.62);
        const input = isDark ? mixColor(average, [0, 0, 0], 0.04) : mixColor(average, [255, 255, 255], 0.8);
        const onInput = getLuminance(input) < 0.42 ? [245, 255, 245] : [0, 35, 10];

        const colors = {
            '--color-page-bg': colorToRgb(average),
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

const crossfadeCoverBackground = (nextCoverUrl) => {
    const previousCoverUrl = appliedCoverBackgroundUrl;

    if (previousCoverUrl === nextCoverUrl) {
        root.style.setProperty('--cover-bg-opacity', '1');
        root.style.setProperty('--cover-bg-scale', '1');
        return;
    }

    const revealNextCover = () => {
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
        if (revealed) {
            return;
        }

        revealed = true;
        revealNextCover();
    };

    preload.onload = safeReveal;
    preload.onerror = safeReveal;
    preload.src = nextCoverUrl;
    preload.decode?.().then(safeReveal).catch(() => {});
    window.setTimeout(safeReveal, 900);
};

const applyCoverBackground = () => {
    if (!coverBackgroundEnabled || !currentCoverUrl || !nowPlayingCover.complete) {
        return;
    }

    try {
        const average = readCoverColor();
        const isDark = getLuminance(average) < 0.42;
        const overlay = !adaptiveCoverColorsEnabled
            ? 'linear-gradient(rgba(116, 198, 157, 0.34), rgba(216, 243, 220, 0.44))'
            : isDark
                ? 'linear-gradient(rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.28))'
                : 'linear-gradient(rgba(0, 35, 10, 0.16), rgba(0, 35, 10, 0.22))';

        crossfadeCoverBackground(currentCoverUrl);
        root.style.setProperty('--cover-readable-overlay', overlay);
        root.classList.add('has-cover-theme');
        document.body.classList.add('has-cover-theme');
        localStorage.setItem(COVER_BACKGROUND_STORAGE_KEY, JSON.stringify({
            url: currentCoverUrl,
            overlay,
            pageBg: colorToRgb(average),
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
    const travelDuration = Math.max(3500, travelDistance * 65);
    const returnDuration = Math.max(900, travelDistance * 22);

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

                content.style.transform = 'translateX(0)';
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
    } else {
        nowPlayingCover.removeAttribute('src');
    }

    nowPlayingCover.classList.toggle('has-cover', Boolean(coverUrl));
    coverThemeButton?.classList.toggle('has-cover', Boolean(coverUrl));
    coverThemeButton?.toggleAttribute('disabled', !coverUrl);

    if (coverUrl && coverBackgroundEnabled) {
        requestAnimationFrame(applyCoverBackground);
    } else if (!coverUrl) {
        resetCoverBackground();
    }

    nowPlayingBar.classList.remove('is-playing', 'is-empty');
    nowPlayingBar.classList.add(`is-${state}`);
    queueNowPlayingMarquees();
};

const setMprisSong = (data) => {
    const state = normalizePlaybackState(data.status);
    const hasSong = Boolean(data.title || data.artist || data.album);

    currentSongData = data;
    setPlaybackState(state);
    nowPlayingTimer.textContent = `${formatPlaybackTime(data.position)} / ${formatPlaybackTime(data.duration)}`;
    updateStatusPillWidth();
    setProgressSlider(data.position, data.duration);

    if (!hasSong || state === 'stopped') {
        currentSongData = null;
        lastTrackId = '';
        lastCoverUrl = '';
        lastLyricsKey = '';
        lyricsEntries = [];
        activeLyricsIndex = -1;
        renderLyrics([]);
        setLyricsStatus('tap the card to fetch lyrics');
        setProgressSlider(null, null);
        setNowPlayingText('nothing playing', 'empty');
        return;
    }

    const nextTrackId = data.trackId || [data.title, data.artist, data.album, data.duration].join('|');
    const coverIdentity = formatCoverIdentity(data, nextTrackId);
    const coverUrl = data.coverUrl ? `${data.coverUrl}?art=${encodeURIComponent(coverIdentity)}` : '';

    if (nextTrackId !== lastTrackId || coverUrl !== lastCoverUrl) {
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

const fetchMprisSong = async () => {
    if (isFetchingMpris) {
        return;
    }

    try {
        isFetchingMpris = true;
        const response = await fetch(MPRIS_URL, { cache: 'no-store' });

        if (!response.ok) {
            throw new Error('mpris unavailable');
        }

        setMprisSong(await response.json());
    } catch {
        setPlaybackState('stopped');
        nowPlayingTimer.textContent = 'mpris unavailable';
        updateStatusPillWidth();
        setProgressSlider(null, null);
        setNowPlayingText('nothing playing', 'empty');
    } finally {
        isFetchingMpris = false;
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

playerControls.forEach((control) => {
    control.addEventListener('click', () => {
        sendMprisControl(control.dataset.mprisAction);
    });
});

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
        sendMprisControl('seek', { position: String(position) });
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

    sendMprisControl('seek', { position: String(position) });
    syncLyricsToPosition(position);
});

nowPlayingCover.addEventListener('load', () => {
    if (coverBackgroundEnabled) {
        applyCoverBackground();
    }
});
window.addEventListener('resize', () => {
    queueNowPlayingMarquees();
    updateStatusPillWidth();
});

setCoverThemeToggle();
updateStatusPillWidth();
setPlaybackState(playbackState);
fetchMprisSong();
setInterval(fetchMprisSong, MPRIS_POLL_INTERVAL);
})();
