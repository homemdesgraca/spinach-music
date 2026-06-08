import { ENDPOINTS, EVENT_NAMES, STORAGE_KEYS } from './js/core/constants.js';
import { listenSpinachEvent } from './js/core/events.js';
import { getStorageBoolean, loadNavidromeConnection } from './js/core/storage.js';

const libraryTabs = document.querySelector('.library-tabs');
const libraryTabButtons = document.querySelectorAll('.library-tab');
const libraryDeck = document.querySelector('.library-deck');
const libraryDeckTrack = document.querySelector('[data-library-deck-track]');
const libraryBackButton = document.querySelector('.library-back');
const libraryProgressTooltip = document.querySelector('.library-progress-tooltip');
const libraryProgressText = libraryProgressTooltip?.querySelector('span');
const subtitleText = document.querySelector('.subtitle-txt');
const nowPlayingBar = document.querySelector('.now-playing-bar');

const TRACK_COVER_STORAGE_KEY = STORAGE_KEYS.FETCH_TRACK_COVERS;
const LIBRARY_ENDPOINT = ENDPOINTS.NAVIDROME_LIBRARY;
const TRACKS_ENDPOINT = ENDPOINTS.NAVIDROME_TRACKS;
const COVER_ENDPOINT = ENDPOINTS.NAVIDROME_COVER;
const CACHE_COVER_ENDPOINT = ENDPOINTS.NAVIDROME_CACHE_COVER;
const CARD_COLORS = [
    ['#d8f3dc', '#40916c'],
    ['#b7e4c7', '#2d6a4f'],
    ['#95d5b2', '#1b4332'],
    ['#74c69d', '#52b788'],
    ['#d8f3dc', '#74c69d'],
    ['#52b788', '#081c15'],
];

const deckCards = {
    artists: [],
    albums: [],
    artistAlbums: [],
    albumTracks: [],
};

const libraryLoadState = {
    artists: 'idle',
    albums: 'idle',
    artistAlbums: 'idle',
    albumTracks: 'idle',
};

const libraryFetchControllers = {
    artists: null,
    albums: null,
    artistAlbums: null,
    albumTracks: null,
};

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

let activeLibraryTab;
let subtitleExitAnimation;
let subtitleAnimationRun = 0;
let tabsMoveAnimation;
let nowPlayingMoveAnimation;
let deckAnimationFrame;
let deckCurrentOffset = 0;
let deckTargetOffset = 0;
let deckLoopWidth = 0;
let deckCardStep = 0;
let deckCardWidth = 0;
let deckCardGap = 0;
let deckCanScroll = true;
let deckIsFinite = false;
let deckFiniteStartX = 0;
let deckMaxOffset = 0;
let deckBuffer = 0;
let deckMode = '';
let deckSlotCards = [];
let deckBaseCards = [];
let libraryMarqueeToken = 0;
let coverWarmupQueue = Promise.resolve();
let libraryDataRun = 0;
let artistAlbumContext = null;
let albumTracksContext = null;
let artistDeckReturnOffset = null;
let deckDropAnimationPending = false;
let deckDropRun = 0;
let deckDropDirection = 'down';
const libraryMarquees = new Map();

const syncViewportVars = () => {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth || 0);
    const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

    if (width) {
        const sideMargin = Math.min(Math.max(width * 0.006, 6), 18);
        const deckWidth = Math.max(320, width - (sideMargin * 2));
        document.documentElement.style.setProperty('--spinach-vw', `${width}px`);
        document.documentElement.style.setProperty('--library-deck-width', `${Math.round(deckWidth)}px`);
    }

    if (height) {
        const widthForHeight = width || window.innerWidth || 0;
        const maxHeight = 22 * rem;
        const minHeight = 15.2 * rem;
        const wideFlattening = Math.max(0, widthForHeight - (96 * rem)) * 0.018;
        const preferredHeight = Math.min(height * 0.48, (21.5 * rem) - wideFlattening);
        const deckHeight = Math.min(maxHeight, Math.max(minHeight, preferredHeight));
        document.documentElement.style.setProperty('--spinach-vh', `${height}px`);
        document.documentElement.style.setProperty('--library-deck-height', `${Math.round(deckHeight)}px`);
    }
};

syncViewportVars();

const shouldFetchIndividualTrackCovers = () => getStorageBoolean(TRACK_COVER_STORAGE_KEY);

const hashText = (value) => String(value || '').split('').reduce((hash, char) => (
    ((hash << 5) - hash) + char.charCodeAt(0)
), 0);

const getCardColors = (title, index = 0) => CARD_COLORS[Math.abs(hashText(title) + index) % CARD_COLORS.length];

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

const formatTrackDuration = (seconds) => {
    const value = Number(seconds);

    if (!Number.isFinite(value) || value <= 0) {
        return 'track';
    }

    const minutes = Math.floor(value / 60);
    const remaining = Math.floor(value % 60);
    return `${minutes}:${String(remaining).padStart(2, '0')}`;
};

const getStatusCard = (mode) => {
    const state = libraryLoadState[mode];
    const label = mode === 'artists' ? 'artists' : mode === 'albumTracks' ? 'tracks' : 'albums';

    if (state === 'loading') {
        return { title: `loading ${label}`, subtitle: 'navidrome', countLabel: 'please wait', colors: ['#d8f3dc', '#52b788'], isStatus: true };
    }

    if (state === 'error') {
        return { title: 'library failed', subtitle: 'check connection', countLabel: 'retry soon', colors: ['#b7e4c7', '#1b4332'], isStatus: true };
    }

    if (state === 'empty') {
        return { title: `no ${label} found`, subtitle: albumTracksContext?.title || artistAlbumContext?.title || 'navidrome', countLabel: 'empty', colors: ['#95d5b2', '#40916c'], isStatus: true };
    }

    return { title: 'connect navidrome', subtitle: 'open config', countLabel: 'needed', colors: ['#d8f3dc', '#40916c'], isStatus: true };
};

const getDeckCards = (mode) => deckCards[mode]?.length ? deckCards[mode] : [getStatusCard(mode)];

const buildLibraryUrl = (mode, context = null) => {
    const connection = loadNavidromeConnection();

    if (!connection?.url || !connection?.username || !connection?.password) {
        return null;
    }

    if ((mode === 'artistAlbums' || mode === 'albumTracks') && !context?.id) {
        return null;
    }

    const url = new URL(mode === 'albumTracks' ? TRACKS_ENDPOINT : LIBRARY_ENDPOINT, window.location.origin);
    if (mode !== 'albumTracks') {
        url.searchParams.set('mode', mode);
    }
    url.searchParams.set('url', connection.url);
    url.searchParams.set('username', connection.username);
    url.searchParams.set('password', connection.password);
    if (mode === 'artistAlbums') {
        url.searchParams.set('artistId', context.id);
        url.searchParams.set('artistTitle', context.title || '');
    }

    if (mode === 'albumTracks') {
        url.searchParams.set('id', context.id);
        url.searchParams.set('type', 'album');
        url.searchParams.set('title', context.title || '');
    }
    return url;
};

const getCoverKey = (item) => `${item.type || 'item'}:${item.id || ''}:${item.coverArt || ''}:${item.imageUrl || ''}`;

const buildCoverUrl = (item, endpoint = COVER_ENDPOINT) => {
    const connection = loadNavidromeConnection();

    if (!connection?.url || !connection?.username || !connection?.password || (!item?.id && !item?.coverArt && !item?.imageUrl)) {
        return null;
    }

    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set('url', connection.url);
    url.searchParams.set('username', connection.username);
    url.searchParams.set('password', connection.password);
    url.searchParams.set('id', item.id || '');
    url.searchParams.set('coverArt', item.coverArt || '');
    url.searchParams.set('imageUrl', item.imageUrl || '');
    url.searchParams.set('type', item.type || '');
    return url;
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

const updateCoverProgress = () => {
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
    libraryProgressTooltip.classList.toggle('is-visible', coverProgress.total > 0 && (coverProgress.active || deckMode === coverProgress.mode));
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

const cacheLibraryCovers = async (mode, items, dataRun = libraryDataRun) => {
    if (dataRun !== libraryDataRun) {
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
                if (!url || dataRun !== libraryDataRun) {
                    throw new Error('missing cover url');
                }

                const response = await fetch(url, { cache: 'no-store' });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload?.ok === false || payload?.found === false) {
                    throw new Error('cover unavailable');
                }

                if (dataRun !== libraryDataRun || run !== coverProgress.run) {
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
                libraryProgressTooltip?.classList.remove('is-visible');
            }
        }, 1800);
    }
};

const queueCoverCaching = (mode, items, dataRun = libraryDataRun) => {
    coverWarmupQueue = coverWarmupQueue
        .catch(() => {})
        .then(() => cacheLibraryCovers(mode, items, dataRun));

    return coverWarmupQueue;
};

const refreshDeckIfActive = (mode, options = {}) => {
    if (deckMode === mode) {
        if (options.drop) {
            deckDropAnimationPending = true;
            deckDropRun += 1;
        }
        requestAnimationFrame(measureDeckLoop);
    }
};

const fetchLibraryMode = async (mode, force = false, context = null) => {
    const requestRun = libraryDataRun;
    const isContextMode = mode === 'artistAlbums' || mode === 'albumTracks';
    const requestContext = mode === 'artistAlbums'
        ? (context || artistAlbumContext)
        : mode === 'albumTracks' ? (context || albumTracksContext) : null;

    if (!force && !isContextMode && (libraryLoadState[mode] === 'loaded' || libraryLoadState[mode] === 'loading')) {
        return;
    }

    const url = buildLibraryUrl(mode, requestContext);
    if (!url) {
        deckCards[mode] = [];
        libraryLoadState[mode] = 'idle';
        refreshDeckIfActive(mode);
        return;
    }

    libraryFetchControllers[mode]?.abort();
    libraryFetchControllers[mode] = new AbortController();
    libraryLoadState[mode] = 'loading';
    deckCards[mode] = [];
    refreshDeckIfActive(mode);

    try {
        const response = await fetch(url.toString(), {
            cache: 'no-store',
            signal: libraryFetchControllers[mode].signal,
        });
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload?.error || 'library failed');
        }

        if (requestRun !== libraryDataRun
            || (mode === 'artistAlbums' && requestContext?.id !== artistAlbumContext?.id)
            || (mode === 'albumTracks' && requestContext?.id !== albumTracksContext?.id)) {
            return;
        }

        const useAlbumCoverForTracks = mode === 'albumTracks' && !shouldFetchIndividualTrackCovers();
        const albumCoverSource = useAlbumCoverForTracks ? {
            id: requestContext?.id || '',
            coverArt: requestContext?.coverArt || '',
            imageUrl: requestContext?.imageUrl || '',
            type: 'album',
        } : null;
        const payloadItems = mode === 'albumTracks'
            ? (payload.tracks || []).map((track, index) => ({
                ...track,
                title: track.title || `track ${index + 1}`,
                subtitle: [track.artist || requestContext?.artist || '', track.album || requestContext?.title || '', formatTrackDuration(track.duration)]
                    .filter(Boolean)
                    .join(' · '),
                tracks: 1,
                countLabel: `#${track.track || index + 1}`,
                type: 'song',
                coverArt: useAlbumCoverForTracks ? (albumCoverSource.coverArt || '') : track.coverArt,
                imageUrl: useAlbumCoverForTracks ? (albumCoverSource.imageUrl || '') : track.imageUrl,
            }))
            : (payload.items || []);

        deckCards[mode] = payloadItems.map((item, index) => {
            const coverSource = useAlbumCoverForTracks ? albumCoverSource : item;
            const hasCoverPointer = Boolean(coverSource?.coverArt || coverSource?.imageUrl || coverSource?.type === 'artist');
            const coverKey = getCoverKey(coverSource || item);
            const cachedCover = coverCache.has(coverKey) ? (coverCache.get(coverKey) || '') : '';
            const coverRequestUrl = useAlbumCoverForTracks
                ? (requestContext?.coverRequestUrl || (hasCoverPointer ? buildCoverUrl(coverSource)?.toString() : '') || '')
                : (buildCoverUrl(coverSource)?.toString() || '');
            const coverCacheUrl = useAlbumCoverForTracks
                ? (requestContext?.coverCacheUrl || (hasCoverPointer ? buildCoverUrl(coverSource, CACHE_COVER_ENDPOINT)?.toString() : '') || '')
                : (buildCoverUrl(coverSource, CACHE_COVER_ENDPOINT)?.toString() || '');
            return {
                ...item,
                coverKey,
                coverRequestUrl,
                coverCacheUrl,
                coverUrl: cachedCover || (useAlbumCoverForTracks ? requestContext?.coverUrl : '') || coverRequestUrl,
                palette: coverPaletteCache.get(coverKey) || (useAlbumCoverForTracks ? requestContext?.palette : null) || null,
                colors: getCardColors(item.title, index),
            };
        });
        libraryLoadState[mode] = deckCards[mode].length ? 'loaded' : 'empty';
        if (deckCards[mode].length) {
            queueCoverCaching(mode, deckCards[mode], requestRun);
        }
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }

        deckCards[mode] = [];
        libraryLoadState[mode] = 'error';
    } finally {
        if (mode === 'artistAlbums' && requestContext?.id === artistAlbumContext?.id) {
            renderLibraryDeck('artistAlbums', { drop: true });
            return;
        }

        if (mode === 'albumTracks' && requestContext?.id === albumTracksContext?.id) {
            renderLibraryDeck('albumTracks', { drop: true });
            return;
        }

        refreshDeckIfActive(mode);
    }
};

const resetLibraryDeckData = () => {
    Object.keys(deckCards).forEach((mode) => {
        libraryFetchControllers[mode]?.abort();
        deckCards[mode] = [];
        libraryLoadState[mode] = 'idle';
    });

    coverCache.clear();
    coverPaletteCache.clear();
    visualPaletteCache.clear();
    coverWarmupQueue = Promise.resolve();
    libraryDataRun += 1;
    coverProgress.mode = '';
    coverProgress.total = 0;
    coverProgress.done = 0;
    coverProgress.active = false;
    coverProgress.run += 1;
    artistAlbumContext = null;
    albumTracksContext = null;
    artistDeckReturnOffset = null;
    setLibraryBackVisible(false);
    document.body.classList.remove('artist-albums-mode', 'album-tracks-mode');
    updateCoverProgress();

    if (deckMode) {
        requestAnimationFrame(measureDeckLoop);
    }
};

const setLibraryBackVisible = (isVisible) => {
    if (!libraryBackButton) {
        return;
    }

    if (!isVisible && libraryBackButton.contains(document.activeElement)) {
        activeLibraryTab?.focus?.({ preventScroll: true });
        if (libraryBackButton.contains(document.activeElement)) {
            libraryBackButton.blur();
        }
    }

    libraryBackButton.classList.toggle('is-visible', isVisible);
    libraryBackButton.disabled = !isVisible;
    libraryBackButton.inert = !isVisible;
    libraryBackButton.setAttribute('tabindex', isVisible ? '0' : '-1');

    if (isVisible) {
        libraryBackButton.removeAttribute('aria-hidden');
    } else {
        libraryBackButton.setAttribute('aria-hidden', 'true');
    }
};

const updateLibraryBackButton = () => {
    setLibraryBackVisible(document.body.classList.contains('library-mode') && (deckMode === 'artistAlbums' || deckMode === 'albumTracks'));
};

const flipElementToState = (element, applyState, options = {}) => {
    if (!element) {
        applyState();
        return;
    }

    const {
        duration = 1750,
        easing = 'cubic-bezier(0.16, 1, 0.3, 1)',
    } = options;
    element.classList.add('is-layout-controlled');
    const first = element.getBoundingClientRect();

    nowPlayingMoveAnimation?.cancel();
    element.style.transition = 'none';
    element.style.transform = '';

    applyState();

    const last = element.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;

    element.style.transition = '';

    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        element.style.transform = '';
        return;
    }

    nowPlayingMoveAnimation = element.animate([
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' },
    ], {
        duration,
        easing,
        fill: 'both',
    });

    nowPlayingMoveAnimation.onfinish = () => {
        element.style.transform = '';
        nowPlayingMoveAnimation = null;
    };
};

const getCurrentTranslate = (element) => {
    const transform = getComputedStyle(element).transform;

    if (!transform || transform === 'none') {
        return { x: 0, y: 0 };
    }

    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42 };
};

const setTooltipAnchor = (selectedTab = null) => {
    if (!libraryTabs || !libraryProgressTooltip) {
        return;
    }

    if (!selectedTab) {
        libraryTabs.style.setProperty('--library-tooltip-left', '50%');
        return;
    }

    const tabCenter = selectedTab.offsetLeft + (selectedTab.offsetWidth / 2);
    libraryTabs.style.setProperty('--library-tooltip-left', `${tabCenter}px`);
};

const getFocusedTabShift = (selectedTab) => {
    const tabsTranslate = getCurrentTranslate(libraryTabs);
    const tabRect = selectedTab.getBoundingClientRect();
    const visibleTabCenter = tabRect.left + tabRect.width / 2;
    const untransformedTabCenter = visibleTabCenter - tabsTranslate.x;
    const untransformedTabTop = tabRect.top - tabsTranslate.y;
    const deckBottom = libraryDeck ? libraryDeck.offsetTop + libraryDeck.offsetHeight : 0;
    const targetY = deckBottom ? deckBottom - 2 - untransformedTabTop : tabsTranslate.y;

    return {
        x: window.innerWidth / 2 - untransformedTabCenter,
        y: targetY,
    };
};

const animateTabsToCenter = (selectedTab) => {
    setTooltipAnchor(selectedTab);
    const current = getCurrentTranslate(libraryTabs);
    const target = getFocusedTabShift(selectedTab);
    const targetTransform = `translate(${target.x}px, ${target.y}px)`;

    tabsMoveAnimation?.cancel();
    libraryTabs.getAnimations().forEach((animation) => animation.cancel());
    libraryTabs.style.setProperty('--library-tabs-shift', `${target.x}px`);
    libraryTabs.style.transform = `translate(${current.x}px, ${current.y}px)`;

    tabsMoveAnimation = libraryTabs.animate([
        { transform: `translate(${current.x}px, ${current.y}px)` },
        { transform: targetTransform },
    ], {
        duration: 1150,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
    });

    tabsMoveAnimation.onfinish = () => {
        libraryTabs.style.transform = targetTransform;
    };
};

const animateSubtitleOut = () => {
    if (!subtitleText) {
        return;
    }

    const run = ++subtitleAnimationRun;
    const computed = getComputedStyle(subtitleText);
    const startOpacity = computed.opacity;
    const startTransform = computed.transform === 'none' ? 'translateX(0)' : computed.transform;

    subtitleExitAnimation?.cancel();
    subtitleText.getAnimations().forEach((animation) => animation.cancel());
    subtitleText.classList.add('is-leaving', 'is-layout-controlled');
    subtitleText.style.opacity = startOpacity;
    subtitleText.style.transform = startTransform;

    subtitleExitAnimation = subtitleText.animate([
        { opacity: startOpacity, transform: startTransform, offset: 0 },
        { opacity: 0.82, transform: 'translateX(-32vw)', offset: 0.25 },
        { opacity: 0.5, transform: 'translateX(-65vw)', offset: 0.5 },
        { opacity: 0.18, transform: 'translateX(-98vw)', offset: 0.75 },
        { opacity: 0, transform: 'translateX(-130vw)', offset: 1 },
    ], {
        duration: 2050,
        easing: 'cubic-bezier(0.34, 0.02, 0.2, 1)',
        fill: 'forwards',
    });

    subtitleExitAnimation.onfinish = () => {
        if (run !== subtitleAnimationRun) {
            return;
        }

        subtitleText.style.opacity = '0';
        subtitleText.style.transform = 'translateX(-130vw)';
    };
};

const animateSubtitleIn = () => {
    if (!subtitleText) {
        return;
    }

    const run = ++subtitleAnimationRun;
    const computed = getComputedStyle(subtitleText);
    const startOpacity = computed.opacity;
    const startTransform = computed.transform === 'none' ? 'translateX(-130vw)' : computed.transform;

    subtitleExitAnimation?.cancel();
    subtitleText.getAnimations().forEach((animation) => animation.cancel());
    subtitleText.classList.add('is-leaving', 'is-layout-controlled');
    subtitleText.style.opacity = startOpacity;
    subtitleText.style.transform = startTransform;

    subtitleExitAnimation = subtitleText.animate([
        { opacity: startOpacity, transform: startTransform },
        { opacity: 1, transform: 'translateX(0)' },
    ], {
        duration: 1250,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
    });

    subtitleExitAnimation.onfinish = () => {
        if (run !== subtitleAnimationRun) {
            return;
        }

        subtitleText.style.opacity = '1';
        subtitleText.style.transform = 'translateX(0)';
        subtitleText.classList.remove('is-leaving');
    };
};

const createDeckCard = (item, index = 0) => {
    const { title, subtitle = '', tracks = 0, colors = CARD_COLORS[0], type = 'album', countLabel = '', coverKey = '', coverUrl = '', palette = null, isStatus = false } = item;
    const card = document.createElement('article');
    const titleElement = document.createElement('h3');
    const titleText = document.createElement('span');
    const coverElement = document.createElement('div');
    const countElement = document.createElement('span');
    const tilts = ['-1deg', '1.2deg', '-0.35deg', '0.75deg'];
    const tilt = isStatus ? '-0.35deg' : tilts[index % tilts.length];
    const count = Number(tracks) || 0;
    const defaultCountLabel = type === 'artist'
        ? `${count} ${count === 1 ? 'album' : 'albums'}`
        : type === 'song' ? 'play' : `${count} ${count === 1 ? 'track' : 'tracks'}`;

    card.className = 'library-card';
    card.classList.toggle('is-status-card', Boolean(isStatus));
    card.classList.toggle('is-track-card', type === 'song');
    card.tabIndex = isStatus ? -1 : 0;
    if (!isStatus) {
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', type === 'artist'
            ? `show albums by ${title}`
            : type === 'album' ? `show tracks from ${title}` : `play ${title}`);
    }
    card.dataset.tilt = tilt;
    if (coverKey) {
        card.dataset.coverKey = coverKey;
    }
    card.style.setProperty('--card-tilt', tilt);
    card.style.setProperty('--cover-a', colors[0]);
    card.style.setProperty('--cover-b', colors[1]);
    applyPaletteToCard(card, palette);

    titleElement.className = 'library-card-title';
    titleText.className = 'library-card-title-text';
    titleText.textContent = title;
    titleElement.append(titleText);
    card.append(titleElement);

    if (subtitle) {
        const subtitleElement = document.createElement('p');
        subtitleElement.className = 'library-card-subtitle';
        subtitleElement.textContent = subtitle;
        card.append(subtitleElement);
    }

    coverElement.className = 'library-card-cover';
    coverElement.classList.toggle('has-cover', Boolean(coverUrl));
    coverElement.setAttribute('aria-hidden', 'true');
    if (coverUrl) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.setAttribute('aria-hidden', 'true');
        image.src = coverUrl;
        queueImagePalette(card, image, coverKey);
        coverElement.append(image);
    }
    card.append(coverElement);

    countElement.className = 'library-card-count';
    countElement.textContent = countLabel || defaultCountLabel;
    card.append(countElement);

    return card;
};

const modulo = (value, size) => ((value % size) + size) % size;

const getRemSize = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const getDeckCardMetrics = () => {
    const rem = getRemSize();
    const cardWidth = Math.min(Math.max(13 * rem, window.innerWidth * 0.21), 18 * rem);
    const gap = 0.7 * rem;

    return { cardWidth, gap, step: cardWidth + gap };
};

const applyDeckTransform = () => {
    if (!deckLoopWidth || !deckCardStep || !deckSlotCards.length || !deckBaseCards.length) {
        return;
    }

    const baseCount = deckBaseCards.length;
    const offset = deckIsFinite
        ? Math.max(0, Math.min(deckCurrentOffset, deckMaxOffset))
        : deckCanScroll ? deckCurrentOffset : 0;
    const centerSlot = Math.floor(deckSlotCards.length / 2);
    const staticWidth = (baseCount * deckCardWidth) + (Math.max(0, baseCount - 1) * deckCardGap);
    const staticStartX = deckIsFinite ? deckFiniteStartX : -(staticWidth / 2);
    const dropDistance = Math.max(libraryDeck?.clientHeight || 300, 260);
    const recyclePadding = deckCardStep * 2;
    const leftRecycleEdge = -((libraryDeck?.clientWidth || window.innerWidth) / 2) - recyclePadding;
    const rightRecycleEdge = ((libraryDeck?.clientWidth || window.innerWidth) / 2) + recyclePadding;
    let changedContent = false;

    deckSlotCards.forEach((card, slotIndex) => {
        let virtualSlot = Number.parseInt(card.dataset.virtualSlot, 10);
        if (!Number.isFinite(virtualSlot)) {
            virtualSlot = slotIndex - centerSlot;
        }

        if (deckCanScroll && !deckIsFinite) {
            let virtualX = (virtualSlot * deckCardStep) - offset - (deckCardWidth / 2);
            const slotSpan = deckSlotCards.length * deckCardStep;

            while (virtualX < leftRecycleEdge) {
                virtualSlot += deckSlotCards.length;
                virtualX += slotSpan;
            }

            while (virtualX > rightRecycleEdge) {
                virtualSlot -= deckSlotCards.length;
                virtualX -= slotSpan;
            }
        }

        const dataIndex = deckIsFinite
            ? slotIndex
            : deckCanScroll ? modulo(virtualSlot, baseCount) : slotIndex;
        let activeCard = card;

        if (activeCard.dataset.itemIndex !== String(dataIndex)) {
            activeCard.querySelectorAll('.library-card-title-text').forEach(stopLibraryMarquee);
            const nextCard = createDeckCard(deckBaseCards[dataIndex], dataIndex);
            nextCard.dataset.itemIndex = String(dataIndex);
            nextCard.dataset.slotIndex = String(slotIndex);
            nextCard.dataset.virtualSlot = String(virtualSlot);
            libraryDeckTrack.replaceChild(nextCard, activeCard);
            deckSlotCards[slotIndex] = nextCard;
            activeCard = nextCard;
            changedContent = true;
        } else {
            activeCard.dataset.virtualSlot = String(virtualSlot);
        }

        const x = deckIsFinite
            ? staticStartX + (slotIndex * deckCardStep) - offset
            : deckCanScroll
                ? (virtualSlot * deckCardStep) - offset - (deckCardWidth / 2)
                : staticStartX + (slotIndex * deckCardStep);
        const finalTransform = `translate3d(${x}px, 0, 0) rotate(${activeCard.dataset.tilt})`;
        activeCard.style.transform = finalTransform;

        if (deckDropAnimationPending && activeCard.dataset.dropRun !== String(deckDropRun)) {
            activeCard.dataset.dropRun = String(deckDropRun);
            const isReverseDrop = deckDropDirection === 'up';
            const startY = isReverseDrop ? dropDistance : -dropDistance;
            const overshootY = isReverseDrop ? -18 : 18;
            const dropAnimation = activeCard.animate([
                { opacity: 0, transform: `translate3d(${x}px, ${startY}px, 0) rotate(${activeCard.dataset.tilt})` },
                { opacity: 1, transform: `translate3d(${x}px, ${overshootY}px, 0) rotate(${activeCard.dataset.tilt})`, offset: 0.82 },
                { opacity: 1, transform: finalTransform },
            ], {
                duration: 760 + (Math.min(slotIndex, 6) * 54),
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'none',
            });
            dropAnimation.onfinish = () => {
                if (activeCard.dataset.dropRun === String(deckDropRun)) {
                    activeCard.style.opacity = '1';
                    activeCard.style.transform = finalTransform;
                }
                dropAnimation.cancel();
            };
        }
    });

    if (deckDropAnimationPending) {
        deckDropAnimationPending = false;
    }

    if (changedContent) {
        queueLibraryMarquees(false, { immediateNew: true });
    }
};

const stopLibraryMarquee = (content) => {
    const state = libraryMarquees.get(content);
    clearTimeout(state?.timeout);
    state?.animation?.cancel();
    content.classList.remove('is-overflowing');
    content.style.transform = '';
    libraryMarquees.delete(content);
};

const stopLibraryMarquees = () => {
    libraryMarqueeToken += 1;
    libraryMarquees.forEach((_, content) => stopLibraryMarquee(content));
};

const startLibraryMarquee = (line, content, token, pause = 1900, options = {}) => {
    const variant = options.variant || 'normal';
    const force = Boolean(options.force);

    if (token !== libraryMarqueeToken || !line || !content || !content.textContent.trim()) {
        return;
    }

    const existing = libraryMarquees.get(content);
    if (existing && existing.variant === variant && !force) {
        return;
    }

    if (existing) {
        stopLibraryMarquee(content);
    }

    const overflowDistance = content.scrollWidth - line.clientWidth;

    if (overflowDistance <= 4) {
        stopLibraryMarquee(content);
        return;
    }

    const travelDistance = overflowDistance + 16;
    const endTransform = `translateX(-${travelDistance}px)`;
    const travelDuration = variant === 'hover'
        ? Math.max(720, travelDistance * 13)
        : Math.max(1250, travelDistance * 23);
    const returnDuration = variant === 'hover'
        ? Math.max(260, travelDistance * 5)
        : Math.max(420, travelDistance * 8);

    content.classList.add('is-overflowing');
    content.style.transform = 'translateX(0)';

    const timeout = window.setTimeout(() => {
        if (token !== libraryMarqueeToken) {
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

        libraryMarquees.set(content, { animation, timeout: null, variant });

        animation.onfinish = () => {
            if (token !== libraryMarqueeToken) {
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

            libraryMarquees.set(content, { animation: returnAnimation, timeout: null, variant });

            returnAnimation.onfinish = () => {
                if (token !== libraryMarqueeToken) {
                    return;
                }

                returnAnimation.cancel();
                content.style.transform = 'translateX(0)';
                libraryMarquees.delete(content);
                requestAnimationFrame(() => startLibraryMarquee(line, content, token, pause, options));
            };
        };
    }, pause);

    libraryMarquees.set(content, { animation: null, timeout, variant });
};

const queueLibraryMarquees = (reset = true, options = {}) => {
    if (reset) {
        stopLibraryMarquees();
    }
    const token = libraryMarqueeToken;
    const immediateNew = Boolean(options.immediateNew);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            libraryDeckTrack?.querySelectorAll('.library-card-title').forEach((line, index) => {
                const content = line.querySelector('.library-card-title-text');
                const pause = immediateNew && !libraryMarquees.has(content)
                    ? 0
                    : 1600 + ((index % 4) * 180);
                startLibraryMarquee(line, content, token, pause);
            });
        });
    });
};

const measureDeckLoop = () => {
    if (!libraryDeck || !libraryDeckTrack || !deckMode) {
        return;
    }

    const { cardWidth, gap, step } = getDeckCardMetrics();
    deckBaseCards = getDeckCards(deckMode);
    const baseCount = deckBaseCards.length || 1;
    const visibleWidth = libraryDeck.clientWidth || window.innerWidth;
    const rem = getRemSize();
    const isFiniteTrackDeck = deckMode === 'albumTracks';
    const reservedWidth = isFiniteTrackDeck ? 8.4 * rem : deckMode === 'artistAlbums' ? 6.4 * rem : 1.2 * rem;
    const leftInset = isFiniteTrackDeck ? 7.35 * rem : 0;
    const rightInset = isFiniteTrackDeck ? 1.25 * rem : 0;
    const availableWidth = Math.max(cardWidth, visibleWidth - reservedWidth);
    const totalContentWidth = (baseCount * cardWidth) + (Math.max(0, baseCount - 1) * gap);
    const fitsWithoutScroll = (deckMode === 'artistAlbums' || isFiniteTrackDeck) && totalContentWidth <= availableWidth;
    const minimumSlots = Math.ceil((visibleWidth + (step * 4)) / step);
    const slotCount = isFiniteTrackDeck
        ? baseCount
        : fitsWithoutScroll ? baseCount : (baseCount === 1 ? 1 : Math.max(minimumSlots, 7));

    deckIsFinite = isFiniteTrackDeck;
    deckCanScroll = baseCount > 1 && (isFiniteTrackDeck ? !fitsWithoutScroll : !fitsWithoutScroll);
    deckCardWidth = cardWidth;
    deckCardGap = gap;
    deckCardStep = step;
    deckFiniteStartX = -(visibleWidth / 2) + leftInset;
    deckMaxOffset = isFiniteTrackDeck
        ? Math.max(0, totalContentWidth - Math.max(cardWidth, visibleWidth - leftInset - rightInset))
        : 0;
    deckBuffer = step * 2;
    deckLoopWidth = Math.max(baseCount * step, step);

    if (deckIsFinite) {
        deckCurrentOffset = deckCanScroll ? Math.max(0, Math.min(deckCurrentOffset, deckMaxOffset)) : 0;
    } else {
        deckCurrentOffset = deckCanScroll ? modulo(deckCurrentOffset, deckLoopWidth) : 0;
    }
    deckTargetOffset = deckCurrentOffset;

    const centerSlot = Math.floor(slotCount / 2);
    const firstVirtualSlot = deckCanScroll && !deckIsFinite ? Math.floor(deckCurrentOffset / step) : 0;

    stopLibraryMarquees();
    libraryDeckTrack.innerHTML = '';
    deckSlotCards = Array.from({ length: slotCount }, (_, index) => {
        const virtualSlot = deckCanScroll && !deckIsFinite ? firstVirtualSlot + index - centerSlot : index;
        const dataIndex = deckIsFinite ? index : deckCanScroll ? modulo(virtualSlot, baseCount) : index;
        const card = createDeckCard(deckBaseCards[dataIndex], dataIndex);
        card.dataset.itemIndex = String(dataIndex);
        card.dataset.slotIndex = String(index);
        card.dataset.virtualSlot = String(virtualSlot);
        libraryDeckTrack.append(card);
        return card;
    });
    applyDeckTransform();
    queueLibraryMarquees();
};

const renderLibraryDeck = (mode, options = {}) => {
    if (!libraryDeck || !libraryDeckTrack) {
        return;
    }

    const isSameMode = deckMode === mode;
    deckMode = mode;
    libraryDeck.dataset.deckMode = mode;
    libraryDeck.setAttribute('aria-hidden', 'false');
    document.body.classList.toggle('artist-albums-mode', mode === 'artistAlbums');
    document.body.classList.toggle('album-tracks-mode', mode === 'albumTracks');
    updateLibraryBackButton();

    if (deckAnimationFrame) {
        cancelAnimationFrame(deckAnimationFrame);
        deckAnimationFrame = null;
    }

    if (!isSameMode) {
        const restoredOffset = Number.isFinite(options.restoreOffset) ? options.restoreOffset : 0;
        deckCurrentOffset = restoredOffset;
        deckTargetOffset = restoredOffset;
    }

    if (options.drop) {
        deckDropRun += 1;
        deckDropDirection = options.direction === 'up' ? 'up' : 'down';
        requestAnimationFrame(() => {
            deckDropAnimationPending = true;
            measureDeckLoop();
        });
        return;
    }

    requestAnimationFrame(measureDeckLoop);
};

const animateDeckScroll = () => {
    if (deckIsFinite) {
        deckTargetOffset = Math.max(0, Math.min(deckTargetOffset, deckMaxOffset));
    }

    deckCurrentOffset += (deckTargetOffset - deckCurrentOffset) * 0.12;

    if (!deckIsFinite && Math.abs(deckCurrentOffset) > deckLoopWidth * 50 && deckLoopWidth) {
        const remainingDistance = deckTargetOffset - deckCurrentOffset;
        deckCurrentOffset = modulo(deckCurrentOffset, deckLoopWidth);
        deckTargetOffset = deckCurrentOffset + remainingDistance;
    }

    applyDeckTransform();

    if (Math.abs(deckTargetOffset - deckCurrentOffset) > 0.2) {
        deckAnimationFrame = requestAnimationFrame(animateDeckScroll);
    } else {
        deckCurrentOffset = deckIsFinite ? Math.max(0, Math.min(deckTargetOffset, deckMaxOffset)) : deckTargetOffset;
        deckTargetOffset = deckCurrentOffset;
        applyDeckTransform();
        deckAnimationFrame = null;
    }
};

const interruptDeckDrop = () => {
    deckDropAnimationPending = false;
    deckSlotCards.forEach((card) => {
        card.getAnimations().forEach((animation) => animation.cancel());
        card.style.opacity = '1';
    });
    applyDeckTransform();
};

const queueDeckScroll = (delta) => {
    if (!libraryDeckTrack || !deckLoopWidth || !deckCanScroll) {
        return;
    }

    interruptDeckDrop();
    deckTargetOffset += delta;

    if (deckIsFinite) {
        deckTargetOffset = Math.max(0, Math.min(deckTargetOffset, deckMaxOffset));
    }

    if (!deckAnimationFrame) {
        deckAnimationFrame = requestAnimationFrame(animateDeckScroll);
    }
};

const animateTabsHome = () => {
    setTooltipAnchor();
    const current = getCurrentTranslate(libraryTabs);

    tabsMoveAnimation?.cancel();
    libraryTabs.getAnimations().forEach((animation) => animation.cancel());
    libraryTabs.style.setProperty('--library-tabs-shift', '0px');
    libraryTabs.style.transform = `translate(${current.x}px, ${current.y}px)`;

    tabsMoveAnimation = libraryTabs.animate([
        { transform: `translate(${current.x}px, ${current.y}px)` },
        { transform: 'translate(0, 0)' },
    ], {
        duration: 950,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards',
    });

    tabsMoveAnimation.onfinish = () => {
        libraryTabs.style.transform = '';
    };
};

const closeLibraryMode = () => {
    activeLibraryTab = null;
    artistAlbumContext = null;
    albumTracksContext = null;
    artistDeckReturnOffset = null;
    stopLibraryMarquees();
    animateSubtitleIn();

    flipElementToState(nowPlayingBar, () => {
        document.body.classList.remove('library-mode');
        libraryTabs.classList.remove('is-focused');
        delete libraryTabs.dataset.activeTab;
        document.body.classList.remove('artist-albums-mode', 'album-tracks-mode');
        libraryDeck?.setAttribute('aria-hidden', 'true');
        updateLibraryBackButton();

        libraryTabButtons.forEach((tab) => {
            tab.classList.remove('is-selected', 'is-counterpart');
            tab.setAttribute('aria-selected', 'false');
        });
    });

    animateTabsHome();
};

const openLibraryTab = (selectedTab) => {
    if (activeLibraryTab === selectedTab && document.body.classList.contains('library-mode')) {
        closeLibraryMode();
        return;
    }

    const mode = selectedTab.dataset.libraryTab;
    artistAlbumContext = null;
    albumTracksContext = null;
    artistDeckReturnOffset = null;
    activeLibraryTab = selectedTab;
    animateSubtitleOut();
    renderLibraryDeck(mode);
    fetchLibraryMode(mode);

    flipElementToState(nowPlayingBar, () => {
        document.body.classList.add('library-mode');
        libraryTabs.classList.add('is-focused');
        libraryTabs.dataset.activeTab = mode;

        libraryTabButtons.forEach((tab) => {
            const isSelected = tab === selectedTab;
            tab.classList.toggle('is-selected', isSelected);
            tab.classList.toggle('is-counterpart', !isSelected);
            tab.setAttribute('aria-selected', isSelected);
        });
    });

    animateTabsToCenter(selectedTab);
};

libraryTabButtons.forEach((tab) => {
    tab.addEventListener('click', () => openLibraryTab(tab));
});

libraryDeck?.addEventListener('wheel', (event) => {
    event.preventDefault();
    queueDeckScroll(event.deltaY || event.deltaX);
}, { passive: false });

const restartCardMarquee = (card, hover = false) => {
    const line = card?.querySelector('.library-card-title');
    const content = line?.querySelector('.library-card-title-text');

    if (!line || !content) {
        return;
    }

    const slotIndex = Number.parseInt(card.dataset.slotIndex, 10) || 0;
    stopLibraryMarquee(content);
    startLibraryMarquee(line, content, libraryMarqueeToken, hover ? 1000 : 1600 + ((slotIndex % 4) * 180), {
        variant: hover ? 'hover' : 'normal',
        force: true,
    });
};

libraryDeckTrack?.addEventListener('pointerover', (event) => {
    const card = event.target.closest('.library-card');

    if (!card || card.contains(event.relatedTarget)) {
        return;
    }

    restartCardMarquee(card, true);
});

libraryDeckTrack?.addEventListener('pointerout', (event) => {
    const card = event.target.closest('.library-card');

    if (!card || card.contains(event.relatedTarget)) {
        return;
    }

    restartCardMarquee(card, false);
});

const openArtistAlbums = (artist) => {
    if (!artist?.id) {
        return;
    }

    if (deckMode === 'artists') {
        artistDeckReturnOffset = deckCurrentOffset;
    }

    artistAlbumContext = { id: artist.id, title: artist.title || 'artist' };
    libraryLoadState.artistAlbums = 'loading';
    deckCards.artistAlbums = [];
    fetchLibraryMode('artistAlbums', true, artistAlbumContext);
};

const openAlbumTracks = (album) => {
    if (!album?.id) {
        return;
    }

    preloadNowPlayingBackground(album, {
        album: album.title || 'album',
        artist: album.subtitle || album.artist || artistAlbumContext?.title || '',
    });

    albumTracksContext = {
        id: album.id,
        title: album.title || 'album',
        artist: album.subtitle || album.artist || artistAlbumContext?.title || '',
        coverArt: album.coverArt || '',
        imageUrl: album.imageUrl || '',
        coverKey: album.coverKey || getCoverKey(album),
        coverRequestUrl: album.coverRequestUrl || '',
        coverCacheUrl: album.coverCacheUrl || '',
        coverUrl: album.coverUrl || '',
        palette: album.palette || null,
        returnMode: deckMode === 'artistAlbums' ? 'artistAlbums' : 'albums',
        returnOffset: deckCurrentOffset,
        artistContext: artistAlbumContext ? { ...artistAlbumContext } : null,
    };
    libraryLoadState.albumTracks = 'loading';
    deckCards.albumTracks = [];
    fetchLibraryMode('albumTracks', true, albumTracksContext);
};

const backToPreviousLibraryView = () => {
    if (!document.body.classList.contains('library-mode')) {
        return;
    }

    if (deckMode === 'albumTracks') {
        const context = albumTracksContext;
        const returnMode = context?.returnMode === 'artistAlbums' ? 'artistAlbums' : 'albums';
        const restoreOffset = context?.returnOffset;
        artistAlbumContext = returnMode === 'artistAlbums' ? context?.artistContext : null;
        albumTracksContext = null;
        renderLibraryDeck(returnMode, { drop: true, direction: 'up', restoreOffset });
        if (!deckCards[returnMode]?.length) {
            fetchLibraryMode(returnMode, false, artistAlbumContext);
        }
        return;
    }

    const restoreOffset = artistDeckReturnOffset;
    artistAlbumContext = null;
    albumTracksContext = null;
    renderLibraryDeck('artists', { drop: true, direction: 'up', restoreOffset });
    fetchLibraryMode('artists');
};

const playDeckCard = (card) => {
    if (!card || card.classList.contains('is-status-card')) {
        return;
    }

    const itemIndex = Number.parseInt(card.dataset.itemIndex, 10);
    const item = deckBaseCards[itemIndex];
    if (!item) {
        return;
    }

    if (item.type === 'artist' && deckMode === 'artists') {
        openArtistAlbums(item);
        return;
    }

    if (item.type === 'album' && (deckMode === 'albums' || deckMode === 'artistAlbums')) {
        openAlbumTracks(item);
        return;
    }

    if (item.type === 'song' && deckMode === 'albumTracks') {
        preloadNowPlayingBackground(item, albumTracksContext || {});
        window.spinachPlayer?.playQueue?.(deckBaseCards.filter((track) => track?.type === 'song'), itemIndex);
        return;
    }

    preloadNowPlayingBackground(item);
    window.spinachPlayer?.playLibraryItem?.(item);
};

libraryDeckTrack?.addEventListener('click', (event) => {
    playDeckCard(event.target.closest('.library-card'));
});

libraryBackButton?.addEventListener('click', backToPreviousLibraryView);

listenSpinachEvent(EVENT_NAMES.ADVANCED_SETTINGS_CHANGED, (event) => {
    if (event.detail?.setting !== 'trackCovers' || deckMode !== 'albumTracks' || !albumTracksContext?.id) {
        return;
    }

    libraryLoadState.albumTracks = 'loading';
    deckCards.albumTracks = [];
    fetchLibraryMode('albumTracks', true, albumTracksContext);
});

libraryDeckTrack?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    const card = event.target.closest('.library-card');
    if (!card) {
        return;
    }

    event.preventDefault();
    playDeckCard(card);
});

const getViewportSignature = () => {
    const viewport = window.visualViewport;
    return [
        Math.round(viewport?.width || window.innerWidth || 0),
        Math.round(viewport?.height || window.innerHeight || 0),
        window.devicePixelRatio || 1,
    ].join('x');
};

let lastViewportSignature = getViewportSignature();

const handleViewportChange = () => {
    lastViewportSignature = getViewportSignature();
    syncViewportVars();

    if (activeLibraryTab) {
        animateTabsToCenter(activeLibraryTab);
        requestAnimationFrame(measureDeckLoop);
    }
};

window.addEventListener('resize', handleViewportChange);
window.visualViewport?.addEventListener('resize', handleViewportChange);
window.setInterval(() => {
    const signature = getViewportSignature();

    if (signature !== lastViewportSignature) {
        handleViewportChange();
    }
}, 300);

const warmLibraryCache = () => {
    if (!buildLibraryUrl('artists')) {
        return;
    }

    fetchLibraryMode('artists');
    fetchLibraryMode('albums');
};

listenSpinachEvent(EVENT_NAMES.CACHE_CLEARED, (event) => {
    const cache = event.detail?.cache;
    if (cache !== 'covers' && cache !== 'palettes') {
        return;
    }

    coverPaletteCache.clear();
    visualPaletteCache.clear();

    if (cache === 'covers') {
        coverCache.clear();
    }

    Object.values(deckCards).flat().forEach((item) => {
        item.palette = null;
        if (cache === 'covers') {
            item.coverUrl = '';
        }
    });

    if (cache === 'palettes') {
        recalculateVisibleCardPalettes();
    }
});

listenSpinachEvent(EVENT_NAMES.NAVIDROME_CONNECTION_CHANGE, (event) => {
    const connected = event.detail?.connected === true;
    resetLibraryDeckData();

    if (activeLibraryTab?.dataset.libraryTab) {
        const mode = activeLibraryTab.dataset.libraryTab;
        renderLibraryDeck(mode, { drop: true });
        if (connected) {
            fetchLibraryMode(mode, true);
        }
        return;
    }

    if (connected) {
        warmLibraryCache();
    }
});

window.setTimeout(warmLibraryCache, 650);
