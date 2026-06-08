import { formatPlaybackTime } from './progress.js';

export const normalizePlaybackState = (state) => {
    const normalized = String(state || '').toLowerCase();

    if (normalized.includes('play')) {
        return 'playing';
    }

    if (normalized.includes('pause')) {
        return 'paused';
    }

    return 'stopped';
};

export const formatSongMeta = (album, artist) => ({
    album: album || '',
    artist: artist || '',
});

export const formatCoverIdentity = (data, fallbackTrackId) => {
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

export const createDisplayRenderer = ({
    root = document.documentElement,
    elements,
    coverTheme,
    marquee,
    setCurrentCoverUrl,
    getCurrentCoverUrl,
    onPlaybackStateChange,
}) => {
    const {
        coverThemeButton,
        nowPlayingAlbum,
        nowPlayingArtist,
        nowPlayingBar,
        nowPlayingCover,
        nowPlayingProgress,
        nowPlayingStatusPill,
        nowPlayingTimer,
        nowPlayingTitle,
        playPauseControl,
    } = elements;
    let playbackState = 'stopped';
    let coverRetryRun = 0;
    let forceNextCoverLoad = false;

    const updateStatusPillWidth = () => {
        if (!nowPlayingStatusPill) {
            return;
        }

        root.style.setProperty('--status-pill-width', `${Math.ceil(nowPlayingStatusPill.offsetWidth)}px`);
    };

    const setStatusText = (message, options = {}) => {
        if (nowPlayingTimer) {
            nowPlayingTimer.textContent = message;
        }

        if (options.updateWidth !== false) {
            updateStatusPillWidth();
        }
    };

    const setPlaybackState = (state) => {
        playbackState = normalizePlaybackState(state);
        nowPlayingBar?.classList.toggle('is-paused', playbackState !== 'playing');

        if (playPauseControl) {
            playPauseControl.textContent = playbackState === 'playing' ? 'pause' : 'play';
            playPauseControl.classList.toggle('is-active-state', playbackState === 'playing');
            playPauseControl.setAttribute('aria-label', playbackState === 'playing' ? 'pause playback' : 'play playback');
            playPauseControl.setAttribute('aria-pressed', playbackState === 'playing');
        }

        onPlaybackStateChange?.(playbackState);
    };

    const addCoverRetryParam = (coverUrl) => {
        if (!coverUrl) {
            return '';
        }

        try {
            const url = new URL(coverUrl, window.location.origin);
            url.searchParams.set('spinachCoverRetry', String(++coverRetryRun));
            return url.toString();
        } catch {
            const separator = coverUrl.includes('?') ? '&' : '?';
            return `${coverUrl}${separator}spinachCoverRetry=${++coverRetryRun}`;
        }
    };

    const setNowPlayingText = (title, state = 'empty', coverUrl = '', meta = {}) => {
        nowPlayingTitle.textContent = title;
        nowPlayingAlbum.textContent = meta.album || '';
        nowPlayingArtist.textContent = meta.artist || '';

        const shouldForceCoverLoad = Boolean(coverUrl && forceNextCoverLoad);
        const nextCoverUrl = shouldForceCoverLoad ? addCoverRetryParam(coverUrl) : coverUrl;
        forceNextCoverLoad = false;
        setCurrentCoverUrl(nextCoverUrl);

        if (nextCoverUrl) {
            if (shouldForceCoverLoad) {
                nowPlayingCover.removeAttribute('src');
            }
            if (nowPlayingCover.getAttribute('src') !== nextCoverUrl) {
                nowPlayingCover.src = nextCoverUrl;
            }
        } else if (!coverTheme.hasAppliedBackground()) {
            nowPlayingCover.removeAttribute('src');
        }

        nowPlayingCover.classList.toggle('has-cover', Boolean(coverUrl));
        coverThemeButton?.classList.toggle('has-cover', Boolean(coverUrl));
        coverThemeButton?.toggleAttribute('disabled', !coverUrl);

        if (coverUrl && coverTheme.isBackgroundEnabled()) {
            coverTheme.startPreload();
            requestAnimationFrame(coverTheme.applyCoverBackground);
        }

        nowPlayingBar.classList.remove('is-playing', 'is-empty');
        nowPlayingBar.classList.add(`is-${state}`);
        marquee.queue();
    };

    const setTimerFromPosition = (position, duration) => {
        setStatusText(`${formatPlaybackTime(position)} / ${formatPlaybackTime(duration)}`);
    };

    return {
        getCurrentCoverUrl,
        getPlaybackState: () => playbackState,
        markCoverForRetry: () => {
            forceNextCoverLoad = true;
        },
        setForceNextCoverLoad: (force = true) => {
            forceNextCoverLoad = force;
        },
        setNowPlayingText,
        setPlaybackState,
        setStatusText,
        setTimerFromPosition,
        updateStatusPillWidth,
    };
};
