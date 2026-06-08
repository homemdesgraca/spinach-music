import { DEFAULTS, EVENT_NAMES, PLAYER_SOURCES, STORAGE_KEYS } from '../core/constants.js';
import { listenSpinachEvent } from '../core/events.js';
import {
    getPlayerSource,
    getStorageJson,
    getStorageValue,
    setStorageJson,
    setStorageValue,
} from '../core/storage.js';
import { createMarqueeController } from '../ui/marquee.js';
import { createCoverThemeController } from './cover-theme.js';
import { createLyricsController } from './lyrics.js';
import { createMprisController } from './mpris.js';
import { clamp, createProgressController, getRangeWheelDirection } from './progress.js';
import { createDisplayRenderer, formatCoverIdentity, formatSongMeta, normalizePlaybackState } from './render.js';

const elements = {
    nowPlayingBar: document.querySelector('.now-playing-bar'),
    coverThemeButton: document.querySelector('.cover-theme-button'),
    nowPlayingTitle: document.querySelector('#now-playing-title'),
    nowPlayingAlbum: document.querySelector('#now-playing-album'),
    nowPlayingArtist: document.querySelector('#now-playing-artist'),
    nowPlayingCover: document.querySelector('#now-playing-cover'),
    nowPlayingTimer: document.querySelector('#now-playing-timer'),
    nowPlayingStatusPill: document.querySelector('.now-playing-status-pill'),
    nowPlayingProgress: document.querySelector('#now-playing-progress'),
    playerVolumeSlider: document.querySelector('#player-volume-slider'),
    playerVolumeValue: document.querySelector('#player-volume-value'),
    progressTimeBubble: document.querySelector('#progress-time-bubble'),
    nowPlayingTitleLine: document.querySelector('.now-playing-title-line'),
    nowPlayingArtistLine: document.querySelector('.now-playing-artist-line'),
    playerControls: document.querySelectorAll('.player-control'),
    playPauseControl: document.querySelector('[data-mpris-action="toggle"]'),
    coverThemeToggle: document.querySelector('#cover-theme-toggle'),
    lyricsDrawer: document.querySelector('.lyrics-drawer'),
    lyricsTab: document.querySelector('.lyrics-tab'),
    lyricsClose: document.querySelector('.lyrics-close'),
    lyricsCard: document.querySelector('.lyrics-card'),
    lyricsStatus: document.querySelector('#lyrics-status'),
    lyricsLines: document.querySelector('#lyrics-lines'),
};

const root = document.documentElement;
const VOLUME_STORAGE_KEY = STORAGE_KEYS.VOLUME;
const LAST_SONG_STORAGE_KEY = STORAGE_KEYS.LAST_SONG;

let playerSource = getPlayerSource();
let renderedPlayerSource = '';
let forceNextPlayerRender = true;
let mprisVolumeTimer;
let lastTrackId = '';
let lastCoverUrl = '';
let currentSongData = null;
let currentCoverUrl = '';
let suppressSavedLastSong = false;
let mprisController;
let display;

const isMprisSource = () => playerSource === PLAYER_SOURCES.MPRIS;

const marquee = createMarqueeController([
    { line: elements.nowPlayingTitleLine, content: elements.nowPlayingTitle, pause: 2000 },
    { line: elements.nowPlayingArtistLine, content: elements.nowPlayingArtist, pause: 2300 },
]);

const coverTheme = createCoverThemeController({
    root,
    coverThemeButton: elements.coverThemeButton,
    coverThemeToggle: elements.coverThemeToggle,
    nowPlayingCover: elements.nowPlayingCover,
    getCurrentCoverUrl: () => currentCoverUrl,
    getCurrentSongData: () => currentSongData,
    onCoverError: () => display?.markCoverForRetry(),
});

const sendPlayerControl = (action, params = {}) => {
    if (isMprisSource()) {
        mprisController?.sendControl(action, params);
        return;
    }

    window.spinachPlayer?.control?.(action, params);
};

const progress = createProgressController({
    progressSlider: elements.nowPlayingProgress,
    progressTimeBubble: elements.progressTimeBubble,
    sendPlayerControl,
});

const lyrics = createLyricsController({
    lyricsDrawer: elements.lyricsDrawer,
    lyricsTab: elements.lyricsTab,
    lyricsClose: elements.lyricsClose,
    lyricsCard: elements.lyricsCard,
    lyricsStatus: elements.lyricsStatus,
    lyricsLines: elements.lyricsLines,
    getCurrentSongData: () => currentSongData,
    setCurrentSongData: (songData) => {
        currentSongData = songData;
    },
    sendPlayerControl,
});

display = createDisplayRenderer({
    root,
    elements,
    coverTheme,
    marquee,
    getCurrentCoverUrl: () => currentCoverUrl,
    setCurrentCoverUrl: (coverUrl) => {
        currentCoverUrl = coverUrl;
    },
});

const setVolumeSlider = (volume, persist = false) => {
    if (!elements.playerVolumeSlider || !Number.isFinite(volume)) {
        return;
    }

    const safeVolume = clamp(volume, 0, 1);
    const percent = Math.round(safeVolume * 100);
    elements.playerVolumeSlider.value = String(percent);
    elements.playerVolumeSlider.style.setProperty('--progress', `${percent}%`);
    elements.playerVolumeSlider.setAttribute('aria-valuetext', `${percent}%`);
    if (elements.playerVolumeValue) {
        elements.playerVolumeValue.textContent = `${percent}%`;
    }

    if (persist) {
        setStorageValue(VOLUME_STORAGE_KEY, String(safeVolume));
    }
};

const getStoredVolume = () => {
    const stored = Number.parseFloat(getStorageValue(VOLUME_STORAGE_KEY));
    return Number.isFinite(stored) ? clamp(stored, 0, 1) : DEFAULTS.VOLUME;
};

const getSavedLastSong = () => getStorageJson(LAST_SONG_STORAGE_KEY, null);

const saveLastSong = (data = {}) => {
    if (!(data.title || data.artist || data.album)) {
        return;
    }

    const nextTrackId = data.trackId || [data.title, data.artist, data.album, data.duration].join('|');
    setStorageJson(LAST_SONG_STORAGE_KEY, {
        source: data.source || playerSource,
        title: data.title || '',
        artist: data.artist || '',
        album: data.album || '',
        coverUrl: data.coverUrl || data.artUrl || '',
        position: Number.isFinite(Number(data.position)) ? Number(data.position) : 0,
        duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
        trackId: nextTrackId,
        savedAt: Date.now(),
    });
};

const showSavedLastSong = (statusText = 'last played') => {
    if (suppressSavedLastSong) {
        return false;
    }

    const saved = getSavedLastSong();

    if (!(saved?.title || saved?.artist || saved?.album)) {
        return false;
    }

    const nextTrackId = saved.trackId || [saved.title, saved.artist, saved.album, saved.duration].join('|');
    const coverIdentity = formatCoverIdentity(saved, nextTrackId);
    const coverSeparator = saved.coverUrl?.includes('?') ? '&' : '?';
    const coverUrl = saved.coverUrl ? `${saved.coverUrl}${coverSeparator}art=${encodeURIComponent(coverIdentity)}` : '';

    currentSongData = { ...saved, status: 'stopped' };
    display.setPlaybackState('stopped');
    display.setStatusText(statusText);
    progress.setProgressSlider(saved.position, saved.duration);
    display.setNowPlayingText(saved.title || 'unknown song', 'playing', coverUrl, formatSongMeta(saved.album, saved.artist));
    lastTrackId = nextTrackId;
    lastCoverUrl = coverUrl;
    lyrics.reset('tap the card to fetch lyrics', { delayShrink: true });
    return true;
};

const setPlayerSong = (data = {}, options = {}) => {
    if (options.forceRender) {
        forceNextPlayerRender = true;
    }

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
    display.setPlaybackState(state);
    display.setTimerFromPosition(data.position, data.duration);
    progress.setProgressSlider(data.position, data.duration);

    if (hasSong) {
        suppressSavedLastSong = false;
        saveLastSong(data);
    }

    const nextTrackId = data.trackId || [data.title, data.artist, data.album, data.duration].join('|');
    const coverIdentity = formatCoverIdentity(data, nextTrackId);
    const coverSeparator = data.coverUrl?.includes('?') ? '&' : '?';
    const coverUrl = data.coverUrl ? `${data.coverUrl}${coverSeparator}art=${encodeURIComponent(coverIdentity)}` : '';

    if (hasSong && state === 'stopped') {
        if ((shouldForceRender || nextTrackId !== lastTrackId || coverUrl !== lastCoverUrl) && coverUrl) {
            display.setNowPlayingText(
                data.title || 'unknown song',
                'playing',
                coverUrl,
                formatSongMeta(data.album, data.artist),
            );
            lastTrackId = nextTrackId;
            lastCoverUrl = coverUrl;
        }
        lyrics.syncToPosition(data.position || data.duration || 0);
        return;
    }

    if (!hasSong) {
        if (showSavedLastSong(isMprisSource() ? 'mpris stopped' : 'last played')) {
            return;
        }

        display.setStatusText(isMprisSource() ? 'mpris stopped' : 'choose an album or artist');
        lyrics.reset('tap the card to fetch lyrics', { delayShrink: true });
        lastTrackId = '';
        lastCoverUrl = '';
        progress.setProgressSlider(null, null);
        display.setNowPlayingText('nothing playing', 'empty');
        return;
    }

    if (shouldForceRender || nextTrackId !== lastTrackId || coverUrl !== lastCoverUrl) {
        display.setNowPlayingText(
            data.title || 'unknown song',
            'playing',
            coverUrl,
            formatSongMeta(data.album, data.artist),
        );
        lastTrackId = nextTrackId;
        lastCoverUrl = coverUrl;

        lyrics.fetchLyrics(true);
    } else {
        lyrics.syncToPosition(data.position);
    }
};

const resetNowPlayingDisplay = (statusText = 'connect navidrome') => {
    suppressSavedLastSong = true;
    forceNextPlayerRender = true;
    display.setForceNextCoverLoad(true);
    coverTheme.resetDisabledByUser();
    currentSongData = null;
    currentCoverUrl = '';
    lastTrackId = '';
    lastCoverUrl = '';
    display.setPlaybackState('stopped');
    display.setStatusText(statusText);
    progress.setProgressSlider(null, null);
    lyrics.reset('tap the card to fetch lyrics', { delayShrink: true });
    coverTheme.reset(false, { removeImage: true });
    display.setNowPlayingText('nothing playing', 'empty');
};

mprisController = createMprisController({
    isMprisSource,
    setPlayerSong,
    showSavedLastSong,
    setPlaybackState: display.setPlaybackState,
    setStatusText: display.setStatusText,
    setProgressSlider: progress.setProgressSlider,
    setNowPlayingText: display.setNowPlayingText,
});

const sendPlayerVolume = (volume, immediate = false) => {
    const safeVolume = clamp(volume, 0, 1);
    setVolumeSlider(safeVolume, true);

    if (!isMprisSource()) {
        window.spinachPlayer?.control?.('volume', { volume: String(safeVolume) });
        return;
    }

    clearTimeout(mprisVolumeTimer);
    const send = () => mprisController.sendControl('volume', { volume: String(safeVolume) });

    if (immediate) {
        send();
        return;
    }

    mprisVolumeTimer = setTimeout(send, 90);
};

const showBrowserPlayerIdle = () => {
    const state = window.spinachPlayer?.getState?.();
    if (state?.title || state?.artist || state?.album) {
        setPlayerSong(state);
        return;
    }

    if (!showSavedLastSong('last played')) {
        display.setPlaybackState('stopped');
        display.setStatusText('navidrome player');
        progress.setProgressSlider(null, null);
        display.setNowPlayingText('nothing playing', 'empty');
    }
};

const refreshPlayerSource = () => {
    const previousSource = playerSource;
    playerSource = getPlayerSource();
    forceNextPlayerRender = true;
    lastTrackId = '';
    lastCoverUrl = '';

    if (previousSource !== playerSource) {
        lyrics.reset('tap the card to fetch lyrics');
    }

    if (isMprisSource()) {
        mprisController.startPolling({ force: previousSource !== playerSource });
        return;
    }

    mprisController.stopPolling();
    sendPlayerVolume(getStoredVolume(), true);
    showBrowserPlayerIdle();
};

elements.playerControls.forEach((control) => {
    control.addEventListener('click', () => {
        sendPlayerControl(control.dataset.mprisAction);
    });
});

if (elements.playerVolumeSlider) {
    setVolumeSlider(getStoredVolume());

    elements.playerVolumeSlider.addEventListener('input', () => {
        sendPlayerVolume((Number.parseFloat(elements.playerVolumeSlider.value) || 0) / 100);
    });

    const volumeWheelTarget = elements.playerVolumeSlider.parentElement || elements.playerVolumeSlider;

    volumeWheelTarget.addEventListener('wheel', (event) => {
        const direction = getRangeWheelDirection(event);

        if (!direction || elements.playerVolumeSlider.disabled) {
            return;
        }

        event.preventDefault();

        const min = Number.parseFloat(elements.playerVolumeSlider.min) || 0;
        const max = Number.parseFloat(elements.playerVolumeSlider.max) || 100;
        const step = Number.parseFloat(elements.playerVolumeSlider.step) || 1;
        const currentVolume = Number.parseFloat(elements.playerVolumeSlider.value) || 0;
        const nextVolume = clamp(currentVolume + (direction * step), min, max);

        sendPlayerVolume(nextVolume / 100);
    }, { passive: false });

    elements.playerVolumeSlider.addEventListener('change', () => {
        sendPlayerVolume((Number.parseFloat(elements.playerVolumeSlider.value) || 0) / 100, true);
    });
}

progress.bindEvents();
coverTheme.bindEvents();
lyrics.bindEvents();

listenSpinachEvent(EVENT_NAMES.ADVANCED_SETTINGS_CHANGED, (event) => {
    if (event.detail?.setting !== 'backgroundQuality' || !currentCoverUrl || !coverTheme.isBackgroundEnabled()) {
        return;
    }

    coverTheme.invalidateBackgroundIdentity();
    coverTheme.startPreload();
    coverTheme.applyCoverBackground();
});

listenSpinachEvent(EVENT_NAMES.CACHE_CLEARED, (event) => {
    if (event.detail?.cache !== 'palettes' || !coverTheme.isBackgroundEnabled() || !currentCoverUrl) {
        return;
    }

    coverTheme.applyAdaptiveCoverColors();
});

window.addEventListener('resize', () => {
    marquee.queue();
    display.updateStatusPillWidth();
});

listenSpinachEvent(EVENT_NAMES.NAVIDROME_CONNECTION_CHANGE, (event) => {
    forceNextPlayerRender = true;
    display.setForceNextCoverLoad(true);
    lastTrackId = '';
    lastCoverUrl = '';

    if (event.detail?.connected === false) {
        resetNowPlayingDisplay('connect navidrome');
        return;
    }

    coverTheme.enableBackgroundUnlessUserDisabled();
});

listenSpinachEvent(EVENT_NAMES.PLAYER_STATE, (event) => {
    if (!isMprisSource()) {
        setPlayerSong(event.detail || {});
    }
});

listenSpinachEvent(EVENT_NAMES.PLAYER_MESSAGE, (event) => {
    if (!isMprisSource() && event.detail?.message) {
        display.setStatusText(event.detail.message);
    }
});

listenSpinachEvent(EVENT_NAMES.PLAYER_SOURCE_CHANGE, refreshPlayerSource);

window.spinachNowPlaying = {
    ...(window.spinachNowPlaying || {}),
    preloadCoverBackground: coverTheme.preloadCoverBackground,
};

coverTheme.setToggle();
display.updateStatusPillWidth();
display.setPlaybackState(display.getPlaybackState());
refreshPlayerSource();
