(() => {
const nowPlayingBar = document.querySelector('.now-playing-bar');
const coverThemeButton = document.querySelector('.cover-theme-button');
const nowPlayingTitle = document.querySelector('#now-playing-title');
const nowPlayingAlbum = document.querySelector('#now-playing-album');
const nowPlayingArtist = document.querySelector('#now-playing-artist');
const nowPlayingCover = document.querySelector('#now-playing-cover');
const nowPlayingTimer = document.querySelector('#now-playing-timer');
const nowPlayingProgress = document.querySelector('#now-playing-progress');
const progressTimeBubble = document.querySelector('#progress-time-bubble');
const nowPlayingTitleLine = document.querySelector('.now-playing-title-line');
const nowPlayingArtistLine = document.querySelector('.now-playing-artist-line');
const playerControls = document.querySelectorAll('.player-control');
const playPauseControl = document.querySelector('[data-mpris-action="toggle"]');
const coverThemeToggle = document.querySelector('#cover-theme-toggle');

const MPRIS_URL = '/mpris';
const MPRIS_CONTROL_URL = '/mpris/control';
const MPRIS_POLL_INTERVAL = 1000;
const ADAPTIVE_COLORS_STORAGE_KEY = 'spinachMusic.adaptiveCoverColors';
const COVER_BACKGROUND_STORAGE_KEY = 'spinachMusic.coverBackground';

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
        nowPlayingCover.src = coverUrl;
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
    const coverIdentity = data.artUrl || nextTrackId;
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

nowPlayingCover.addEventListener('load', () => {
    if (coverBackgroundEnabled) {
        applyCoverBackground();
    }
});
window.addEventListener('resize', queueNowPlayingMarquees);

setCoverThemeToggle();
setPlaybackState(playbackState);
fetchMprisSong();
setInterval(fetchMprisSong, MPRIS_POLL_INTERVAL);
})();
