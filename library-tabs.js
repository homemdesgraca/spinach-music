const libraryTabs = document.querySelector('.library-tabs');
const libraryTabButtons = document.querySelectorAll('.library-tab');
const libraryDeck = document.querySelector('.library-deck');
const libraryDeckTrack = document.querySelector('[data-library-deck-track]');
const libraryProgressTooltip = document.querySelector('.library-progress-tooltip');
const libraryProgressText = libraryProgressTooltip?.querySelector('span');
const subtitleText = document.querySelector('.subtitle-txt');
const nowPlayingBar = document.querySelector('.now-playing-bar');

const NAVIDROME_STORAGE_KEY = 'spinachMusic.navidromeConnection';
const LIBRARY_ENDPOINT = '/navidrome/library';
const COVER_ENDPOINT = '/navidrome/cover';
const CACHE_COVER_ENDPOINT = '/navidrome/cache-cover';
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
};

const libraryLoadState = {
    artists: 'idle',
    albums: 'idle',
};

const libraryFetchControllers = {
    artists: null,
    albums: null,
};

const coverCache = new Map();
const coverPaletteCache = new Map();
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
let deckBuffer = 0;
let deckMode = '';
let deckSlotCards = [];
let deckBaseCards = [];
let libraryMarqueeToken = 0;
let coverWarmupQueue = Promise.resolve();
let libraryDataRun = 0;
const libraryMarquees = new Map();

const loadNavidromeConnection = () => {
    try {
        return JSON.parse(localStorage.getItem(NAVIDROME_STORAGE_KEY));
    } catch {
        return null;
    }
};

const hashText = (value) => String(value || '').split('').reduce((hash, char) => (
    ((hash << 5) - hash) + char.charCodeAt(0)
), 0);

const getCardColors = (title, index = 0) => CARD_COLORS[Math.abs(hashText(title) + index) % CARD_COLORS.length];

const getStatusCard = (mode) => {
    const state = libraryLoadState[mode];
    const label = mode === 'artists' ? 'artists' : 'albums';

    if (state === 'loading') {
        return { title: `loading ${label}`, subtitle: 'navidrome', countLabel: 'please wait', colors: ['#d8f3dc', '#52b788'], isStatus: true };
    }

    if (state === 'error') {
        return { title: 'library failed', subtitle: 'check connection', countLabel: 'retry soon', colors: ['#b7e4c7', '#1b4332'], isStatus: true };
    }

    if (state === 'empty') {
        return { title: `no ${label} found`, subtitle: 'navidrome', countLabel: 'empty', colors: ['#95d5b2', '#40916c'], isStatus: true };
    }

    return { title: 'connect navidrome', subtitle: 'open config', countLabel: 'needed', colors: ['#d8f3dc', '#40916c'], isStatus: true };
};

const getDeckCards = (mode) => deckCards[mode]?.length ? deckCards[mode] : [getStatusCard(mode)];

const buildLibraryUrl = (mode) => {
    const connection = loadNavidromeConnection();

    if (!connection?.url || !connection?.username || !connection?.password) {
        return null;
    }

    const url = new URL(LIBRARY_ENDPOINT, window.location.origin);
    url.searchParams.set('mode', mode);
    url.searchParams.set('url', connection.url);
    url.searchParams.set('username', connection.username);
    url.searchParams.set('password', connection.password);
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

const updateCoverProgress = () => {
    if (!libraryProgressTooltip || !libraryProgressText) {
        return;
    }

    const noun = coverProgress.mode === 'artists' ? 'artist covers' : 'album covers';
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
        cover.classList.add('has-cover');
    });
};

const cacheLibraryCovers = async (mode, items, dataRun = libraryDataRun) => {
    if (dataRun !== libraryDataRun) {
        return;
    }

    const run = ++coverProgress.run;
    const candidates = items
        .filter((item) => item.id || item.coverArt || item.imageUrl)
        .map((item) => ({ item, key: getCoverKey(item) }));

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
                    coverPaletteCache.set(key, payload.palette);
                    item.palette = payload.palette;
                }
                item.coverUrl = item.coverRequestUrl || '';
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

const refreshDeckIfActive = (mode) => {
    if (deckMode === mode) {
        requestAnimationFrame(measureDeckLoop);
    }
};

const fetchLibraryMode = async (mode, force = false) => {
    const requestRun = libraryDataRun;

    if (!force && (libraryLoadState[mode] === 'loaded' || libraryLoadState[mode] === 'loading')) {
        return;
    }

    const url = buildLibraryUrl(mode);
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

        if (requestRun !== libraryDataRun) {
            return;
        }

        deckCards[mode] = (payload.items || []).map((item, index) => {
            const coverKey = getCoverKey(item);
            const coverRequestUrl = buildCoverUrl(item)?.toString() || '';
            return {
                ...item,
                coverKey,
                coverRequestUrl,
                coverCacheUrl: buildCoverUrl(item, CACHE_COVER_ENDPOINT)?.toString() || '',
                coverUrl: coverCache.has(coverKey) ? (coverCache.get(coverKey) || '') : coverRequestUrl,
                palette: coverPaletteCache.get(coverKey) || null,
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
    coverWarmupQueue = Promise.resolve();
    libraryDataRun += 1;
    coverProgress.mode = '';
    coverProgress.total = 0;
    coverProgress.done = 0;
    coverProgress.active = false;
    coverProgress.run += 1;
    updateCoverProgress();

    if (deckMode) {
        requestAnimationFrame(measureDeckLoop);
    }
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
        : `${count} ${count === 1 ? 'track' : 'tracks'}`;

    card.className = 'library-card';
    card.classList.toggle('is-status-card', Boolean(isStatus));
    card.tabIndex = isStatus ? -1 : 0;
    if (!isStatus) {
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `play ${title}`);
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
    const offset = modulo(deckCurrentOffset, deckLoopWidth);
    const firstIndex = Math.floor(offset / deckCardStep);
    const fractionalOffset = offset - (firstIndex * deckCardStep);
    const bufferSlots = deckSlotCards.length > 1 ? Math.min(2, deckSlotCards.length - 1) : 0;
    let changedContent = false;

    deckSlotCards.forEach((card, slotIndex) => {
        const slotPosition = slotIndex - bufferSlots;
        const dataIndex = modulo(firstIndex + slotPosition, baseCount);
        let activeCard = card;

        if (activeCard.dataset.itemIndex !== String(dataIndex)) {
            activeCard.querySelectorAll('.library-card-title-text').forEach(stopLibraryMarquee);
            const nextCard = createDeckCard(deckBaseCards[dataIndex], dataIndex);
            nextCard.dataset.itemIndex = String(dataIndex);
            nextCard.dataset.slotIndex = String(slotIndex);
            libraryDeckTrack.replaceChild(nextCard, activeCard);
            deckSlotCards[slotIndex] = nextCard;
            activeCard = nextCard;
            changedContent = true;
        }

        const x = (slotPosition * deckCardStep) - fractionalOffset;
        activeCard.style.transform = `translate3d(${x}px, 0, 0) rotate(${activeCard.dataset.tilt})`;
    });

    if (changedContent) {
        queueLibraryMarquees();
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

const startLibraryMarquee = (line, content, token, pause = 1900) => {
    if (token !== libraryMarqueeToken || !line || !content || !content.textContent.trim()) {
        return;
    }

    const overflowDistance = content.scrollWidth - line.clientWidth;

    if (overflowDistance <= 4) {
        stopLibraryMarquee(content);
        return;
    }

    const travelDistance = overflowDistance + 16;
    const endTransform = `translateX(-${travelDistance}px)`;
    const travelDuration = Math.max(3400, travelDistance * 68);
    const returnDuration = Math.max(900, travelDistance * 22);

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

        libraryMarquees.set(content, { animation, timeout: null });

        animation.onfinish = () => {
            if (token !== libraryMarqueeToken) {
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

            libraryMarquees.set(content, { animation: returnAnimation, timeout: null });

            returnAnimation.onfinish = () => {
                if (token !== libraryMarqueeToken) {
                    return;
                }

                content.style.transform = 'translateX(0)';
                requestAnimationFrame(() => startLibraryMarquee(line, content, token, pause));
            };
        };
    }, pause);

    libraryMarquees.set(content, { animation: null, timeout });
};

const queueLibraryMarquees = () => {
    stopLibraryMarquees();
    const token = libraryMarqueeToken;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            libraryDeckTrack?.querySelectorAll('.library-card-title').forEach((line, index) => {
                const content = line.querySelector('.library-card-title-text');
                startLibraryMarquee(line, content, token, 1600 + ((index % 4) * 180));
            });
        });
    });
};

const measureDeckLoop = () => {
    if (!libraryDeck || !libraryDeckTrack || !deckMode) {
        return;
    }

    const { step } = getDeckCardMetrics();
    deckBaseCards = getDeckCards(deckMode);
    const baseCount = deckBaseCards.length || 1;
    const visibleWidth = libraryDeck.clientWidth || window.innerWidth;
    const minimumSlots = Math.ceil((visibleWidth + (step * 4)) / step);
    const slotCount = baseCount === 1 ? 1 : Math.min(baseCount, minimumSlots);

    deckCardStep = step;
    deckBuffer = step * 2;
    deckLoopWidth = Math.max(baseCount * step, step);

    stopLibraryMarquees();
    libraryDeckTrack.innerHTML = '';
    deckSlotCards = Array.from({ length: slotCount }, (_, index) => {
        const card = createDeckCard(deckBaseCards[index % baseCount], index);
        card.dataset.itemIndex = '';
        card.dataset.slotIndex = String(index);
        libraryDeckTrack.append(card);
        return card;
    });

    deckCurrentOffset = modulo(deckCurrentOffset, deckLoopWidth);
    deckTargetOffset = deckCurrentOffset;
    applyDeckTransform();
    queueLibraryMarquees();
};

const renderLibraryDeck = (mode) => {
    if (!libraryDeck || !libraryDeckTrack) {
        return;
    }

    const isSameMode = deckMode === mode;
    deckMode = mode;
    libraryDeck.dataset.deckMode = mode;
    libraryDeck.setAttribute('aria-hidden', 'false');

    if (!isSameMode) {
        deckCurrentOffset = 0;
        deckTargetOffset = 0;
    }

    requestAnimationFrame(measureDeckLoop);
};

const animateDeckScroll = () => {
    deckCurrentOffset += (deckTargetOffset - deckCurrentOffset) * 0.12;

    if (Math.abs(deckCurrentOffset) > deckLoopWidth * 50 && deckLoopWidth) {
        const remainingDistance = deckTargetOffset - deckCurrentOffset;
        deckCurrentOffset = modulo(deckCurrentOffset, deckLoopWidth);
        deckTargetOffset = deckCurrentOffset + remainingDistance;
    }

    applyDeckTransform();

    if (Math.abs(deckTargetOffset - deckCurrentOffset) > 0.2) {
        deckAnimationFrame = requestAnimationFrame(animateDeckScroll);
    } else {
        deckCurrentOffset = deckTargetOffset;
        applyDeckTransform();
        deckAnimationFrame = null;
    }
};

const queueDeckScroll = (delta) => {
    if (!libraryDeckTrack || !deckLoopWidth) {
        return;
    }

    deckTargetOffset += delta;

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
    stopLibraryMarquees();
    animateSubtitleIn();

    flipElementToState(nowPlayingBar, () => {
        document.body.classList.remove('library-mode');
        libraryTabs.classList.remove('is-focused');
        delete libraryTabs.dataset.activeTab;
        libraryDeck?.setAttribute('aria-hidden', 'true');

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

const playDeckCard = (card) => {
    if (!card || card.classList.contains('is-status-card')) {
        return;
    }

    const itemIndex = Number.parseInt(card.dataset.itemIndex, 10);
    const item = deckBaseCards[itemIndex];
    if (!item) {
        return;
    }

    window.spinachPlayer?.playLibraryItem?.(item);
};

libraryDeckTrack?.addEventListener('click', (event) => {
    playDeckCard(event.target.closest('.library-card'));
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

window.addEventListener('resize', () => {
    if (activeLibraryTab) {
        animateTabsToCenter(activeLibraryTab);
        measureDeckLoop();
    }
});

const warmLibraryCache = () => {
    if (!buildLibraryUrl('artists')) {
        return;
    }

    fetchLibraryMode('artists');
    fetchLibraryMode('albums');
};

window.addEventListener('spinach:navidrome-connection-change', () => {
    resetLibraryDeckData();
    if (activeLibraryTab?.dataset.libraryTab) {
        fetchLibraryMode(activeLibraryTab.dataset.libraryTab, true);
        return;
    }

    warmLibraryCache();
});

window.setTimeout(warmLibraryCache, 650);
