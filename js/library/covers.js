import { ENDPOINTS, STORAGE_KEYS } from '../core/constants.js';
import { getStorageBoolean } from '../core/storage.js';
import { buildNavidromeCoverUrl } from '../services/navidrome-client.js';

const TRACK_COVER_STORAGE_KEY = STORAGE_KEYS.FETCH_TRACK_COVERS;
const CACHE_COVER_ENDPOINT = ENDPOINTS.NAVIDROME_CACHE_COVER;

const getVisualPaletteKey = (paletteKey = '') => {
    const parts = String(paletteKey || '').split('-');
    return parts.length >= 3 ? parts.slice(0, 3).join('-') : String(paletteKey || '');
};

const clampColor = (value) => Math.max(0, Math.min(255, Math.round(value)));
const colorToHex = (color) => `#${color.map((channel) => clampColor(channel).toString(16).padStart(2, '0')).join('')}`;
const colorToRgba = (color, alpha) => `rgba(${color.map(clampColor).join(', ')}, ${alpha})`;
const mixColor = (color, target, amount) => color.map((channel, index) => channel + ((target[index] - channel) * amount));

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

const getLuminance = ([red, green, blue]) => {
    const [r, g, b] = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });

    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};

const readImageColorStats = (image) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const size = 48;

    canvas.width = size;
    canvas.height = size;
    context.drawImage(image, 0, 0, size, size);

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

const buildCardPaletteFromImage = (image) => {
    const { average, accent } = readImageColorStats(image);
    const base = accent || average;
    const isDark = getLuminance(base) < 0.42;
    const primary = isDark ? mixColor(base, [216, 243, 220], 0.24) : mixColor(base, [255, 255, 255], 0.12);
    const secondary = isDark ? mixColor(base, [82, 183, 136], 0.34) : mixColor(base, [255, 255, 255], 0.42);
    const text = isDark ? mixColor(base, [245, 255, 245], 0.9) : mixColor(base, [0, 35, 10], 0.86);
    const shadow = isDark ? mixColor(base, [0, 0, 0], 0.74) : mixColor(base, [0, 20, 8], 0.78);
    const surface = isDark ? mixColor(base, [0, 0, 0], 0.2) : mixColor(base, [255, 255, 255], 0.58);
    const glow = isDark ? mixColor(base, [116, 198, 157], 0.36) : mixColor(base, [45, 106, 79], 0.26);
    const sheen = isDark ? mixColor(base, [255, 255, 255], 0.64) : mixColor(base, [255, 255, 255], 0.68);

    return {
        version: 'client-cover',
        primary: colorToHex(primary),
        secondary: colorToHex(secondary),
        text: colorToHex(text),
        shadow: colorToHex(shadow),
        surface: colorToHex(surface),
        glow: colorToRgba(glow, isDark ? 0.42 : 0.34),
        sheen: colorToRgba(sheen, isDark ? 0.3 : 0.42),
        overlay: isDark ? 'linear-gradient(rgba(255, 255, 255, 0.08), rgba(216, 243, 220, 0.2))' : 'linear-gradient(rgba(0, 35, 10, 0.08), rgba(0, 20, 8, 0.18))',
        average: colorToHex(average),
        accent: colorToHex(base),
        isDark,
    };
};

export const createLibraryCoversController = ({ elements = {}, getDeckMode = () => '', getLibraryDataRun = () => 0 } = {}) => {
    const coverCache = new Map();
    const coverPaletteCache = new Map();
    const visualPaletteCache = new Map();
    const coverProgress = {
        mode: '',
        total: 0,
        done: 0,
        active: false,
        run: 0,
    };
    let coverWarmupQueue = Promise.resolve();

    const shouldFetchIndividualTrackCovers = () => getStorageBoolean(TRACK_COVER_STORAGE_KEY);
    const getCoverKey = (item) => `${item.type || 'item'}:${item.id || ''}:${item.coverArt || ''}:${item.imageUrl || ''}`;
    const buildCoverUrl = buildNavidromeCoverUrl;

    const updateCoverProgress = () => {
        const { libraryProgressTooltip, libraryProgressText } = elements;
        if (!libraryProgressTooltip || !libraryProgressText) {
            return;
        }

        const noun = coverProgress.mode === 'artists'
            ? 'artist covers'
            : coverProgress.mode === 'albumTracks'
                ? (shouldFetchIndividualTrackCovers() ? 'track covers' : 'album cover')
                : 'album covers';
        const percent = coverProgress.total ? Math.round((coverProgress.done / coverProgress.total) * 100) : 0;

        libraryProgressText.textContent = coverProgress.active
            ? `fetching ${noun} ${coverProgress.done}/${coverProgress.total}`
            : `${noun} ready ${coverProgress.done}/${coverProgress.total}`;
        libraryProgressTooltip.style.setProperty('--library-progress', `${percent}%`);
        libraryProgressTooltip.classList.toggle('is-visible', coverProgress.total > 0 && (coverProgress.active || getDeckMode() === coverProgress.mode));
    };

    const applyPaletteToCard = (card, palette = null) => {
        if (!card || !palette) {
            return;
        }

        const vars = {
            '--cover-a': palette.primary,
            '--cover-b': palette.secondary,
            '--card-text': palette.text,
            '--card-shadow': palette.shadow,
            '--card-surface': palette.surface,
            '--card-glow': palette.glow,
            '--card-sheen': palette.sheen,
            '--card-cover-overlay': palette.overlay,
        };

        Object.entries(vars).forEach(([property, value]) => {
            if (value) {
                card.style.setProperty(property, value);
            }
        });

        card.classList.add('has-cover-palette');
        card.classList.toggle('is-dark-cover', Boolean(palette.isDark));
    };

    const applyPaletteToCards = (coverKey, palette) => {
        if (!palette) {
            return;
        }

        document.querySelectorAll('.library-card[data-cover-key]').forEach((card) => {
            if (card.dataset.coverKey === coverKey) {
                applyPaletteToCard(card, palette);
            }
        });
    };

    const queueImagePalette = (card, image, coverKey) => {
        if (!card || !image || !coverKey) {
            return;
        }

        const apply = () => {
            if (!image.naturalWidth || !image.naturalHeight || card.dataset.coverKey !== coverKey) {
                return;
            }

            try {
                const palette = buildCardPaletteFromImage(image);
                coverPaletteCache.set(coverKey, palette);
                applyPaletteToCards(coverKey, palette);
            } catch {}
        };

        if (image.complete) {
            requestAnimationFrame(apply);
            return;
        }

        image.addEventListener('load', apply, { once: true });
    };

    const recalculateVisibleCardPalettes = () => {
        document.querySelectorAll('.library-card[data-cover-key]').forEach((card) => {
            const coverKey = card.dataset.coverKey;
            const image = card.querySelector('.library-card-cover img');

            card.classList.remove('has-cover-palette', 'is-dark-cover');
            queueImagePalette(card, image, coverKey);
        });
    };

    const applyCoverToCards = (coverKey, coverUrl, palette = null) => {
        if (!coverUrl) {
            return;
        }

        document.querySelectorAll('.library-card[data-cover-key]').forEach((card) => {
            if (card.dataset.coverKey !== coverKey) {
                return;
            }

            applyPaletteToCard(card, palette);

            const cover = card.querySelector('.library-card-cover');
            if (!cover) {
                return;
            }

            let image = cover.querySelector('img');
            if (!image) {
                image = document.createElement('img');
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.setAttribute('aria-hidden', 'true');
                cover.append(image);
            }

            image.src = coverUrl;
            queueImagePalette(card, image, coverKey);
            cover.classList.add('has-cover');
        });
    };

    const cacheLibraryCovers = async (mode, items, dataRun = getLibraryDataRun()) => {
        if (dataRun !== getLibraryDataRun()) {
            return;
        }

        const run = ++coverProgress.run;
        const seenCoverKeys = new Set();
        const candidates = items
            .filter((item) => item.coverCacheUrl || item.coverRequestUrl || item.coverUrl || item.coverArt || item.imageUrl || item.type === 'artist')
            .map((item) => ({ item, key: item.coverKey || getCoverKey(item) }))
            .filter(({ key }) => {
                if (!key || seenCoverKeys.has(key)) {
                    return false;
                }

                seenCoverKeys.add(key);
                return true;
            });

        coverProgress.mode = mode;
        coverProgress.total = candidates.length;
        coverProgress.done = candidates.filter(({ key }) => coverCache.has(key)).length;
        coverProgress.active = candidates.some(({ key }) => !coverCache.has(key));

        candidates.forEach(({ item, key }) => {
            if (coverCache.has(key)) {
                item.coverUrl = coverCache.get(key) || '';
                item.palette = coverPaletteCache.get(key) || item.palette || null;
                applyCoverToCards(key, item.coverUrl, item.palette);
            }
        });

        updateCoverProgress();

        const queue = candidates.filter(({ key }) => !coverCache.has(key));
        const worker = async () => {
            while (queue.length) {
                const { item, key } = queue.shift();
                const url = item.coverCacheUrl || buildCoverUrl(item, CACHE_COVER_ENDPOINT)?.toString();

                try {
                    if (!url || dataRun !== getLibraryDataRun()) {
                        throw new Error('missing cover url');
                    }

                    const response = await fetch(url, { cache: 'no-store' });
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok || payload?.ok === false || payload?.found === false) {
                        throw new Error('cover unavailable');
                    }

                    if (dataRun !== getLibraryDataRun() || run !== coverProgress.run) {
                        return;
                    }

                    coverCache.set(key, item.coverRequestUrl || '');
                    if (payload?.palette) {
                        const paletteKey = getVisualPaletteKey(payload.paletteKey || payload.palette.paletteKey || '');
                        const sharedPalette = paletteKey && visualPaletteCache.has(paletteKey)
                            ? visualPaletteCache.get(paletteKey)
                            : payload.palette;

                        if (paletteKey && !visualPaletteCache.has(paletteKey)) {
                            visualPaletteCache.set(paletteKey, sharedPalette);
                        }

                        coverPaletteCache.set(key, sharedPalette);
                        item.palette = sharedPalette;
                    }
                    item.coverUrl = item.coverRequestUrl || '';
                    items.forEach((candidate) => {
                        if ((candidate.coverKey || getCoverKey(candidate)) === key) {
                            candidate.coverUrl = item.coverUrl;
                            candidate.palette = item.palette || candidate.palette || null;
                        }
                    });
                    applyCoverToCards(key, item.coverUrl, item.palette);
                } catch {
                    coverCache.set(key, '');
                } finally {
                    if (run === coverProgress.run) {
                        coverProgress.done += 1;
                        updateCoverProgress();
                    }
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));

        if (run === coverProgress.run && coverProgress.mode === mode) {
            coverProgress.active = false;
            updateCoverProgress();
            window.setTimeout(() => {
                if (!coverProgress.active) {
                    elements.libraryProgressTooltip?.classList.remove('is-visible');
                }
            }, 1800);
        }
    };

    const queueCoverCaching = (mode, items, dataRun = getLibraryDataRun()) => {
        coverWarmupQueue = coverWarmupQueue
            .catch(() => {})
            .then(() => cacheLibraryCovers(mode, items, dataRun));

        return coverWarmupQueue;
    };

    const preloadNowPlayingBackground = (item, fallback = {}) => {
        if (!item) {
            return;
        }

        const coverUrl = item.coverRequestUrl
            || item.coverUrl
            || buildCoverUrl(item)?.toString()
            || fallback.coverUrl
            || '';

        window.spinachNowPlaying?.preloadCoverBackground?.({
            coverUrl,
            title: item.title || fallback.title || '',
            album: item.album || fallback.album || item.title || '',
            artist: item.artist || item.subtitle || fallback.artist || '',
        });
    };

    const resetProgress = () => {
        coverProgress.mode = '';
        coverProgress.total = 0;
        coverProgress.done = 0;
        coverProgress.active = false;
        coverProgress.run += 1;
        updateCoverProgress();
    };

    const resetAll = () => {
        coverCache.clear();
        coverPaletteCache.clear();
        visualPaletteCache.clear();
        coverWarmupQueue = Promise.resolve();
        resetProgress();
    };

    const clearRuntimeCache = (cache) => {
        coverPaletteCache.clear();
        visualPaletteCache.clear();

        if (cache === 'covers') {
            coverCache.clear();
        }

        if (cache === 'palettes') {
            recalculateVisibleCardPalettes();
        }
    };

    return {
        applyPaletteToCard,
        buildCoverCacheUrl: (item) => buildCoverUrl(item, CACHE_COVER_ENDPOINT),
        buildCoverUrl,
        clearRuntimeCache,
        getCachedCover: (coverKey) => (coverCache.has(coverKey) ? (coverCache.get(coverKey) || '') : ''),
        getCoverKey,
        getPalette: (coverKey) => coverPaletteCache.get(coverKey) || null,
        hasCachedCover: (coverKey) => coverCache.has(coverKey),
        preloadNowPlayingBackground,
        queueCoverCaching,
        queueImagePalette,
        recalculateVisibleCardPalettes,
        resetAll,
        resetProgress,
        shouldFetchIndividualTrackCovers,
        updateCoverProgress,
    };
};
