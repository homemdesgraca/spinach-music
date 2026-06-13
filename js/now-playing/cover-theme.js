import { BACKGROUND_COVER_QUALITIES, ENDPOINTS, STORAGE_KEYS } from '../core/constants.js';
import {
    getBackgroundCoverQuality,
    getStorageJson,
    getStorageValue,
    removeStorageValue,
    setStorageBoolean,
    setStorageJson,
} from '../core/storage.js';

const ADAPTIVE_COLORS_STORAGE_KEY = STORAGE_KEYS.ADAPTIVE_COVER_COLORS;
const COVER_BACKGROUND_STORAGE_KEY = STORAGE_KEYS.COVER_BACKGROUND;

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

const getCoverBackgroundIdentity = (data = {}, coverUrl = '') => {
    const album = String(data.album || '').trim().toLowerCase();

    if (album) {
        return `album:${album}`;
    }

    const artist = String(data.artist || '').trim().toLowerCase();
    const title = String(data.title || '').trim().toLowerCase();

    return artist || title ? `track:${artist}:${title}` : `cover:${coverUrl}`;
};

const getCoverBackgroundSize = () => {
    const quality = getBackgroundCoverQuality();

    if (quality === BACKGROUND_COVER_QUALITIES.MAX) {
        return 3000;
    }

    return quality === BACKGROUND_COVER_QUALITIES.AMAZING ? 1600 : 1000;
};

const getStableCoverBackgroundUrl = (coverUrl) => {
    if (!coverUrl) {
        return '';
    }

    try {
        const url = new URL(coverUrl, window.location.origin);

        if (url.pathname === ENDPOINTS.NAVIDROME_COVER && url.searchParams.get('coverArt')) {
            url.searchParams.delete('id');
            url.searchParams.delete('art');
            url.searchParams.set('size', String(getCoverBackgroundSize()));
        }

        return url.pathname === ENDPOINTS.MPRIS_ART
            ? `${url.pathname}${url.search}`
            : url.toString();
    } catch {
        return coverUrl;
    }
};

export const createCoverThemeController = ({
    root = document.documentElement,
    coverThemeButton,
    coverThemeToggle,
    nowPlayingCover,
    getCurrentCoverUrl,
    getCurrentSongData,
    onCoverError,
}) => {
    let coverBackgroundEnabled = true;
    let coverBackgroundDisabledByUser = false;
    let adaptiveCoverColorsEnabled = getStorageValue(ADAPTIVE_COLORS_STORAGE_KEY, 'true') !== 'false';
    let appliedCoverBackgroundUrl = '';
    let appliedCoverBackgroundIdentity = '';
    let coverBackgroundRun = 0;
    const hintedCoverBackgrounds = new Map();

    try {
        const savedCoverBackground = getStorageJson(COVER_BACKGROUND_STORAGE_KEY, null);
        appliedCoverBackgroundUrl = savedCoverBackground?.url || '';
        appliedCoverBackgroundIdentity = savedCoverBackground?.identity || '';
    } catch {}

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

    const resetCoverBackground = (disableBackground = false, options = {}) => {
        const shouldRemoveBackgroundImage = disableBackground || options.removeImage;

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
            if (shouldRemoveBackgroundImage) {
                root.style.removeProperty('--cover-bg');
            }
        }, 900);
        root.style.removeProperty('--cover-readable-overlay');
        removeStorageValue(COVER_BACKGROUND_STORAGE_KEY);
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
        const currentCoverUrl = getCurrentCoverUrl();

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

            const cachedBackground = getStorageJson(COVER_BACKGROUND_STORAGE_KEY, null);
            if (cachedBackground?.url) {
                setStorageJson(COVER_BACKGROUND_STORAGE_KEY, {
                    ...cachedBackground,
                    colors,
                    pageBg: colors['--color-page-bg'],
                });
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
            const currentCoverUrl = getCurrentCoverUrl();
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
        const currentCoverUrl = getCurrentCoverUrl();

        if (!coverBackgroundEnabled || !currentCoverUrl) {
            return;
        }

        try {
            const backgroundCoverUrl = getStableCoverBackgroundUrl(currentCoverUrl);
            const backgroundIdentity = getCoverBackgroundIdentity(getCurrentSongData(), currentCoverUrl);
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

            const cachedBackground = getStorageJson(COVER_BACKGROUND_STORAGE_KEY, null) || {};
            setStorageJson(COVER_BACKGROUND_STORAGE_KEY, {
                ...cachedBackground,
                url: isSameBackground ? appliedCoverBackgroundUrl || backgroundCoverUrl : backgroundCoverUrl,
                identity: backgroundIdentity,
            });
        } catch {}
    };

    const applyCoverBackground = () => {
        const currentCoverUrl = getCurrentCoverUrl();

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
            const backgroundIdentity = getCoverBackgroundIdentity(getCurrentSongData(), currentCoverUrl);
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
            setStorageJson(COVER_BACKGROUND_STORAGE_KEY, {
                url: isSameBackground && appliedCoverBackgroundUrl === backgroundCoverUrl ? appliedCoverBackgroundUrl : backgroundCoverUrl,
                identity: backgroundIdentity,
                overlay,
                pageBg: colorToRgb(base),
            });
            applyAdaptiveCoverColors();
        } catch {
            resetCoverColors();
            startCoverBackgroundPreload();
        }
    };

    const setAdaptiveCoverColorsEnabled = (enabled) => {
        adaptiveCoverColorsEnabled = enabled;
        setStorageBoolean(ADAPTIVE_COLORS_STORAGE_KEY, enabled);
        setCoverThemeToggle();

        if (!enabled) {
            resetCoverColors();
            const cachedBackground = getStorageJson(COVER_BACKGROUND_STORAGE_KEY, null);
            if (cachedBackground?.url) {
                delete cachedBackground.colors;
                setStorageJson(COVER_BACKGROUND_STORAGE_KEY, cachedBackground);
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

    const bindEvents = () => {
        coverThemeButton?.addEventListener('click', () => {
            if (!getCurrentCoverUrl()) {
                return;
            }

            if (coverBackgroundEnabled) {
                coverBackgroundDisabledByUser = true;
                resetCoverBackground(true);
                return;
            }

            coverBackgroundDisabledByUser = false;
            coverBackgroundEnabled = true;
            applyCoverBackground();
        });

        coverThemeToggle?.addEventListener('click', () => {
            setAdaptiveCoverColorsEnabled(!adaptiveCoverColorsEnabled);
        });

        nowPlayingCover?.addEventListener('load', () => {
            if (coverBackgroundEnabled) {
                applyCoverBackground();
            }
        });

        nowPlayingCover?.addEventListener('error', () => {
            onCoverError?.();
            if (getCurrentCoverUrl() && coverBackgroundEnabled) {
                startCoverBackgroundPreload();
            }
            resetCoverColors();
        });
    };

    return {
        applyAdaptiveCoverColors,
        applyCoverBackground,
        bindEvents,
        enableBackgroundUnlessUserDisabled: () => {
            if (!coverBackgroundDisabledByUser) {
                coverBackgroundEnabled = true;
            }
        },
        hasAppliedBackground: () => Boolean(appliedCoverBackgroundUrl),
        invalidateBackgroundIdentity: () => {
            appliedCoverBackgroundIdentity = '';
        },
        isBackgroundEnabled: () => coverBackgroundEnabled,
        preloadCoverBackground: preloadCoverBackgroundHint,
        reset: resetCoverBackground,
        resetDisabledByUser: () => {
            coverBackgroundDisabledByUser = false;
            coverBackgroundEnabled = true;
        },
        resetColors: resetCoverColors,
        setToggle: setCoverThemeToggle,
        startPreload: startCoverBackgroundPreload,
    };
};
