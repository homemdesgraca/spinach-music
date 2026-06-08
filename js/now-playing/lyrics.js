import { ENDPOINTS } from '../core/constants.js';
import { buildNavidromeLyricsUrl } from '../services/navidrome-client.js';
import { formatPlaybackTime } from './progress.js';

const LYRICS_URL = ENDPOINTS.LYRICS;

const formatLyricsKey = (data = {}) => [data.title, data.artist, data.album, Math.round(data.duration || 0)].join('|');
const parseLyricsTimestamp = (minutes, seconds) => (Number(minutes) * 60) + Number(seconds);

const parseSyncedLyrics = (lyrics = '') => lyrics
    .split('\n')
    .map((line) => {
        const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        return match ? { time: parseLyricsTimestamp(match[1], match[2]), text: match[3].trim() } : null;
    })
    .filter((entry) => entry && entry.text);

const fetchNavidromeLyrics = async (songData, signal) => {
    const url = buildNavidromeLyricsUrl(songData);

    if (!url) {
        throw new Error('no navidrome connection');
    }

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

export const createLyricsController = ({
    lyricsDrawer,
    lyricsTab,
    lyricsClose,
    lyricsCard,
    lyricsStatus,
    lyricsLines,
    getCurrentSongData,
    setCurrentSongData,
    sendPlayerControl,
}) => {
    let lastLyricsKey = '';
    let lyricsEntries = [];
    let activeLyricsIndex = -1;
    let isFetchingLyrics = false;
    let pendingLyricsRefresh = false;
    let lyricsFetchToken = 0;
    let lyricsAbortController;
    let lyricsResizeAnimation;
    let lyricsRenderTimer;

    const setLyricsStatus = (message) => {
        if (lyricsStatus) {
            lyricsStatus.textContent = message;
        }
    };

    const isLyricsDrawerOpen = () => lyricsDrawer?.classList.contains('open');

    const fillLyricsLines = (entries, plainLyrics = '') => {
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

    const reset = (status = 'tap the card to fetch lyrics', options = {}) => {
        lyricsAbortController?.abort();
        lyricsFetchToken += 1;
        clearTimeout(lyricsRenderTimer);
        lyricsResizeAnimation?.cancel();
        lyricsResizeAnimation = null;
        if (lyricsCard) {
            lyricsCard.style.height = '';
        }
        if (options.clearSong !== false) {
            setCurrentSongData(null);
        }
        lastLyricsKey = '';
        lyricsEntries = [];
        activeLyricsIndex = -1;
        isFetchingLyrics = false;
        pendingLyricsRefresh = false;
        renderLyrics([], '', { delayShrink: Boolean(options.delayShrink) });
        setLyricsStatus(status);
    };

    const syncToPosition = (position) => {
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
        const songData = getCurrentSongData() ? { ...getCurrentSongData() } : null;

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
            syncToPosition(songData.position);
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
                    syncToPosition(songData.position);
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

    const open = () => {
        lyricsCard?.removeAttribute('inert');
        lyricsCard?.setAttribute('aria-hidden', 'false');
        lyricsDrawer?.classList.add('open');
        lyricsTab?.setAttribute('aria-expanded', 'true');
        lyricsTab?.setAttribute('tabindex', '-1');
        window.setTimeout(() => lyricsClose?.focus({ preventScroll: true }), 120);
        fetchLyrics();
    };

    const close = () => {
        if (lyricsCard?.contains(document.activeElement)) {
            lyricsTab?.focus({ preventScroll: true });
        }

        lyricsDrawer?.classList.remove('open');
        lyricsCard?.setAttribute('inert', '');
        lyricsCard?.setAttribute('aria-hidden', 'true');
        lyricsTab?.setAttribute('aria-expanded', 'false');
        lyricsTab?.removeAttribute('tabindex');
    };

    const bindEvents = () => {
        lyricsTab?.addEventListener('click', () => {
            if (lyricsDrawer?.classList.contains('open')) {
                close();
                return;
            }

            open();
        });

        lyricsClose?.addEventListener('click', close);

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
            syncToPosition(position);
        });
    };

    return {
        bindEvents,
        close,
        fetchLyrics,
        open,
        reset,
        syncToPosition,
    };
};
