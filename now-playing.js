(() => {
const nowPlayingBar = document.querySelector('.now-playing-bar');
const nowPlayingTitle = document.querySelector('#now-playing-title');
const nowPlayingMeta = document.querySelector('#now-playing-meta');
const nowPlayingCover = document.querySelector('#now-playing-cover');
const nowPlayingTimer = document.querySelector('#now-playing-timer');
const nowPlayingProgress = document.querySelector('#now-playing-progress');
const progressTimeBubble = document.querySelector('#progress-time-bubble');
const nowPlayingTitleLine = document.querySelector('.now-playing-title-line');
const playerControls = document.querySelectorAll('.player-control');
const playPauseControl = document.querySelector('[data-mpris-action="toggle"]');

const MPRIS_URL = '/mpris';
const MPRIS_CONTROL_URL = '/mpris/control';
const MPRIS_POLL_INTERVAL = 1000;

let isFetchingMpris = false;
let playbackState = 'stopped';
let lastTrackId = '';
let lastCoverUrl = '';
let titleMarqueeAnimation;
let titleMarqueeTimeout;
let titleMarqueeToken = 0;
let isScrubbingProgress = false;
let currentDuration = 0;

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

const formatSongMeta = (album, artist) => [album, artist].filter(Boolean).join(', ');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

const stopTitleMarquee = () => {
    titleMarqueeToken += 1;
    clearTimeout(titleMarqueeTimeout);
    titleMarqueeAnimation?.cancel();
    titleMarqueeAnimation = null;
    nowPlayingTitle.classList.remove('is-overflowing');
    nowPlayingTitle.style.transform = '';
};

const startTitleMarquee = (token) => {
    if (token !== titleMarqueeToken || !nowPlayingTitleLine) {
        return;
    }

    const overflowDistance = nowPlayingTitle.scrollWidth - nowPlayingTitleLine.clientWidth;

    if (overflowDistance <= 4) {
        stopTitleMarquee();
        return;
    }

    const travelDistance = overflowDistance + 16;
    const endTransform = `translateX(-${travelDistance}px)`;
    const travelDuration = Math.max(3500, travelDistance * 65);
    const returnDuration = Math.max(900, travelDistance * 22);

    nowPlayingTitle.classList.add('is-overflowing');
    nowPlayingTitle.style.transform = 'translateX(0)';

    titleMarqueeTimeout = setTimeout(() => {
        if (token !== titleMarqueeToken) {
            return;
        }

        titleMarqueeAnimation = nowPlayingTitle.animate([
            { transform: 'translateX(0)' },
            { transform: endTransform },
        ], {
            duration: travelDuration,
            easing: 'linear',
            fill: 'forwards',
        });

        titleMarqueeAnimation.onfinish = () => {
            if (token !== titleMarqueeToken) {
                return;
            }

            nowPlayingTitle.style.transform = endTransform;
            titleMarqueeAnimation = nowPlayingTitle.animate([
                { transform: endTransform },
                { transform: 'translateX(0)' },
            ], {
                duration: returnDuration,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'forwards',
            });

            titleMarqueeAnimation.onfinish = () => {
                if (token !== titleMarqueeToken) {
                    return;
                }

                nowPlayingTitle.style.transform = 'translateX(0)';
                requestAnimationFrame(() => startTitleMarquee(token));
            };
        };
    }, 2000);
};

const queueTitleMarquee = () => {
    stopTitleMarquee();
    const token = titleMarqueeToken;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => startTitleMarquee(token));
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

const setNowPlayingText = (title, state = 'empty', coverUrl = '', meta = '') => {
    nowPlayingTitle.textContent = title;
    nowPlayingMeta.textContent = meta;

    if (coverUrl) {
        nowPlayingCover.src = coverUrl;
    } else {
        nowPlayingCover.removeAttribute('src');
    }

    nowPlayingCover.classList.toggle('has-cover', Boolean(coverUrl));
    nowPlayingBar.classList.remove('is-playing', 'is-empty');
    nowPlayingBar.classList.add(`is-${state}`);
    queueTitleMarquee();
};

const setMprisSong = (data) => {
    const state = normalizePlaybackState(data.status);
    const hasSong = Boolean(data.title || data.artist || data.album);

    setPlaybackState(state);
    nowPlayingTimer.textContent = `${formatPlaybackTime(data.position)} / ${formatPlaybackTime(data.duration)}`;
    setProgressSlider(data.position, data.duration);

    if (!hasSong || state === 'stopped') {
        lastTrackId = '';
        lastCoverUrl = '';
        setProgressSlider(null, null);
        setNowPlayingText('nothing playing', 'empty');
        return;
    }

    const nextTrackId = data.trackId || [data.title, data.artist, data.album, data.duration].join('|');
    const coverUrl = data.coverUrl ? `${data.coverUrl}?track=${encodeURIComponent(nextTrackId)}` : '';

    if (nextTrackId !== lastTrackId || coverUrl !== lastCoverUrl) {
        setNowPlayingText(
            data.title || 'unknown song',
            'playing',
            coverUrl,
            formatSongMeta(data.album, data.artist),
        );
        lastTrackId = nextTrackId;
        lastCoverUrl = coverUrl;
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

window.addEventListener('resize', queueTitleMarquee);

setPlaybackState(playbackState);
fetchMprisSong();
setInterval(fetchMprisSong, MPRIS_POLL_INTERVAL);
})();
