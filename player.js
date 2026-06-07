(() => {
const PLAYER_SOURCE_STORAGE_KEY = 'spinachMusic.playerSource';
const NAVIDROME_STORAGE_KEY = 'spinachMusic.navidromeConnection';
const VOLUME_STORAGE_KEY = 'spinachMusic.volume';
const PLAYER_STATE_STORAGE_KEY = 'spinachMusic.navidromePlayerState';
const TRACKS_ENDPOINT = '/navidrome/tracks';
const STREAM_ENDPOINT = '/navidrome/stream';
const COVER_ENDPOINT = '/navidrome/cover';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const loadStoredVolume = () => {
    const stored = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY));
    return Number.isFinite(stored) ? clamp(stored, 0, 1) : 0.82;
};

const audio = new Audio();
audio.preload = 'metadata';
audio.volume = loadStoredVolume();

let queue = [];
let queueIndex = -1;
let currentTrack = null;
let restoredPosition = 0;
let lastStatus = 'stopped';
let stateTimer = null;

const getPlayerSource = () => (
    localStorage.getItem(PLAYER_SOURCE_STORAGE_KEY) === 'mpris' ? 'mpris' : 'navidrome'
);

const isBrowserSource = () => getPlayerSource() !== 'mpris';

const loadNavidromeConnection = () => {
    try {
        return JSON.parse(localStorage.getItem(NAVIDROME_STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
};

const hasConnection = (connection = loadNavidromeConnection()) => Boolean(
    connection?.url && connection?.username && connection?.password
);

const loadSavedPlayerState = () => {
    try {
        return JSON.parse(localStorage.getItem(PLAYER_STATE_STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
};

const savePlayerState = () => {
    if (!currentTrack?.id) {
        return;
    }

    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : restoredPosition;
    const duration = Number.isFinite(audio.duration) ? audio.duration : currentTrack.duration;
    localStorage.setItem(PLAYER_STATE_STORAGE_KEY, JSON.stringify({
        queue,
        queueIndex,
        currentTrack,
        position: Math.max(0, position || 0),
        duration: Number.isFinite(duration) ? duration : currentTrack.duration || null,
        savedAt: Date.now(),
    }));
};

const restorePlayerState = () => {
    const saved = loadSavedPlayerState();
    if (!saved?.currentTrack?.id) {
        return;
    }

    queue = Array.isArray(saved.queue) && saved.queue.length ? saved.queue.filter((track) => track?.id) : [saved.currentTrack];
    queueIndex = Number.isInteger(saved.queueIndex) && saved.queueIndex >= 0 && saved.queueIndex < queue.length
        ? saved.queueIndex
        : Math.max(0, queue.findIndex((track) => track.id === saved.currentTrack.id));
    currentTrack = queue[queueIndex] || saved.currentTrack;
    restoredPosition = Number.isFinite(Number(saved.position)) ? Math.max(0, Number(saved.position)) : 0;
    audio.src = buildStreamUrl(currentTrack);
    audio.currentTime = restoredPosition;
    setMediaSession();
};

const withConnectionParams = (url, connection = loadNavidromeConnection()) => {
    if (!hasConnection(connection)) {
        return null;
    }

    url.searchParams.set('url', connection.url);
    url.searchParams.set('username', connection.username);
    url.searchParams.set('password', connection.password);
    return url;
};

const buildStreamUrl = (track) => {
    const url = withConnectionParams(new URL(STREAM_ENDPOINT, window.location.origin));
    if (!url || !track?.id) {
        return '';
    }

    url.searchParams.set('id', track.id);
    return url.toString();
};

const buildCoverUrl = (track) => {
    if (!track?.coverArt) {
        return '';
    }

    const url = withConnectionParams(new URL(COVER_ENDPOINT, window.location.origin));
    if (!url) {
        return '';
    }

    url.searchParams.set('id', track.id || track.coverArt);
    url.searchParams.set('coverArt', track.coverArt);
    url.searchParams.set('type', 'song');
    url.searchParams.set('size', '768');
    return url.toString();
};

const getStatus = () => {
    if (!currentTrack) {
        return 'stopped';
    }

    if (audio.paused) {
        return audio.ended ? 'stopped' : 'paused';
    }

    return 'playing';
};

const getState = () => {
    const status = getStatus();
    const duration = Number.isFinite(audio.duration) ? audio.duration : (currentTrack?.duration || null);
    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const coverUrl = currentTrack ? buildCoverUrl(currentTrack) : '';

    return {
        source: 'navidrome',
        title: currentTrack?.title || '',
        artist: currentTrack?.artist || '',
        album: currentTrack?.album || '',
        coverUrl,
        position,
        duration,
        volume: audio.volume,
        status,
        trackId: currentTrack?.id || '',
    };
};

const emitState = () => {
    const state = getState();
    lastStatus = state.status;
    if (currentTrack?.id) {
        savePlayerState();
    }
    window.dispatchEvent(new CustomEvent('spinach:player-state', { detail: state }));
    return state;
};

const setMediaSession = () => {
    if (!('mediaSession' in navigator) || !currentTrack) {
        return;
    }

    const coverUrl = buildCoverUrl(currentTrack);
    const artwork = coverUrl
        ? [{ src: coverUrl, sizes: '768x768', type: 'image/jpeg' }]
        : [];

    navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'unknown song',
        artist: currentTrack.artist || '',
        album: currentTrack.album || '',
        artwork,
    });

    navigator.mediaSession.playbackState = getStatus() === 'playing' ? 'playing' : 'paused';
};

const updateMediaPosition = () => {
    if (!('mediaSession' in navigator) || !currentTrack || !Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
    }

    try {
        navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.max(0, audio.currentTime || 0),
        });
        navigator.mediaSession.playbackState = getStatus() === 'playing' ? 'playing' : 'paused';
    } catch {}
};

const startStateTimer = () => {
    clearInterval(stateTimer);
    stateTimer = window.setInterval(() => {
        if (currentTrack && !audio.paused) {
            updateMediaPosition();
            emitState();
        }
    }, 500);
};

const stopStateTimer = () => {
    clearInterval(stateTimer);
    stateTimer = null;
};

const playTrackAt = async (index) => {
    if (!isBrowserSource()) {
        localStorage.setItem(PLAYER_SOURCE_STORAGE_KEY, 'navidrome');
        window.dispatchEvent(new CustomEvent('spinach:player-source-change', { detail: { source: 'navidrome' } }));
    }

    const nextTrack = queue[index];
    if (!nextTrack?.id) {
        emitState();
        return;
    }

    queueIndex = index;
    currentTrack = nextTrack;
    audio.src = buildStreamUrl(currentTrack);
    restoredPosition = 0;
    audio.currentTime = 0;
    setMediaSession();
    emitState();

    try {
        await audio.play();
    } catch {
        emitState();
    }
};

const playQueue = async (tracks = [], startIndex = 0) => {
    queue = tracks.filter((track) => track?.id);
    if (!queue.length) {
        currentTrack = null;
        queueIndex = -1;
        restoredPosition = 0;
        audio.removeAttribute('src');
        emitState();
        return;
    }

    await playTrackAt(Math.max(0, Math.min(startIndex, queue.length - 1)));
};

const buildTracksUrl = (item) => {
    const url = withConnectionParams(new URL(TRACKS_ENDPOINT, window.location.origin));
    if (!url || !item?.id) {
        return null;
    }

    url.searchParams.set('id', item.id);
    url.searchParams.set('type', item.type === 'artist' ? 'artist' : 'album');
    url.searchParams.set('title', item.title || '');
    return url;
};

const playLibraryItem = async (item) => {
    if (!hasConnection()) {
        window.dispatchEvent(new CustomEvent('spinach:player-message', {
            detail: { message: 'connect navidrome first' },
        }));
        emitState();
        return;
    }

    if (item?.type === 'song') {
        await playQueue([item], 0);
        return;
    }

    const url = buildTracksUrl(item);
    if (!url) {
        return;
    }

    window.dispatchEvent(new CustomEvent('spinach:player-message', {
        detail: { message: `loading ${item.type || 'library'}` },
    }));

    try {
        const response = await fetch(url.toString(), { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload?.error || 'tracks unavailable');
        }

        await playQueue(payload.tracks || [], 0);
    } catch {
        window.dispatchEvent(new CustomEvent('spinach:player-message', {
            detail: { message: 'tracks unavailable' },
        }));
        emitState();
    }
};

const control = async (action, params = {}) => {
    if (action === 'volume') {
        const volume = Number.parseFloat(params.volume);
        if (Number.isFinite(volume)) {
            audio.volume = clamp(volume, 0, 1);
            localStorage.setItem(VOLUME_STORAGE_KEY, String(audio.volume));
            emitState();
        }
        return;
    }

    if (!currentTrack && action !== 'play') {
        emitState();
        return;
    }

    if (action === 'toggle') {
        if (audio.paused) {
            await audio.play().catch(() => {});
        } else {
            audio.pause();
        }
        emitState();
        return;
    }

    if (action === 'play') {
        if (currentTrack) {
            await audio.play().catch(() => {});
        }
        emitState();
        return;
    }

    if (action === 'pause') {
        audio.pause();
        emitState();
        return;
    }

    if (action === 'next') {
        if (queueIndex < queue.length - 1) {
            await playTrackAt(queueIndex + 1);
        }
        return;
    }

    if (action === 'previous' || action === 'back') {
        if (audio.currentTime > 4) {
            audio.currentTime = 0;
            emitState();
            return;
        }
        if (queueIndex > 0) {
            await playTrackAt(queueIndex - 1);
        }
        return;
    }

    if (action === 'seek') {
        const position = Number.parseFloat(params.position);
        if (Number.isFinite(position)) {
            audio.currentTime = Math.max(0, position);
            updateMediaPosition();
            emitState();
        }
        return;
    }
};

['play', 'pause', 'loadedmetadata', 'durationchange', 'seeked', 'timeupdate', 'volumechange', 'error'].forEach((eventName) => {
    audio.addEventListener(eventName, () => {
        if (eventName === 'loadedmetadata' && restoredPosition > 0 && Number.isFinite(audio.duration)) {
            audio.currentTime = Math.min(restoredPosition, Math.max(0, audio.duration - 0.2));
            restoredPosition = 0;
        }
        updateMediaPosition();
        emitState();
    });
});

audio.addEventListener('ended', async () => {
    if (queueIndex < queue.length - 1) {
        await playTrackAt(queueIndex + 1);
        return;
    }

    emitState();
});

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => control('play'));
    navigator.mediaSession.setActionHandler('pause', () => control('pause'));
    navigator.mediaSession.setActionHandler('previoustrack', () => control('previous'));
    navigator.mediaSession.setActionHandler('nexttrack', () => control('next'));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (Number.isFinite(details.seekTime)) {
            control('seek', { position: String(details.seekTime) });
        }
    });
}

window.addEventListener('spinach:player-source-change', (event) => {
    if (event.detail?.source === 'mpris') {
        audio.pause();
        stopStateTimer();
        return;
    }

    startStateTimer();
    emitState();
});

window.addEventListener('spinach:navidrome-connection-change', () => {
    if (!hasConnection()) {
        audio.pause();
        currentTrack = null;
        queue = [];
        queueIndex = -1;
        restoredPosition = 0;
    }
    emitState();
});

restorePlayerState();
startStateTimer();
window.spinachPlayer = {
    audio,
    control,
    getState,
    playLibraryItem,
    playQueue,
};

if (isBrowserSource()) {
    emitState();
}
})();
