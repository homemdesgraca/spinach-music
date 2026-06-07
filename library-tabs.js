const libraryTabs = document.querySelector('.library-tabs');
const libraryTabButtons = document.querySelectorAll('.library-tab');
const libraryDeck = document.querySelector('.library-deck');
const libraryDeckTrack = document.querySelector('[data-library-deck-track]');
const subtitleText = document.querySelector('.subtitle-txt');
const nowPlayingBar = document.querySelector('.now-playing-bar');

const deckCards = {
    artists: [
        { title: 'leaf pile', tracks: 42, colors: ['#d8f3dc', '#40916c'] },
        { title: 'green radio', tracks: 18, colors: ['#b7e4c7', '#2d6a4f'] },
        { title: 'window moss', tracks: 27, colors: ['#95d5b2', '#1b4332'] },
        { title: 'garden static', tracks: 33, colors: ['#74c69d', '#52b788'] },
        { title: 'soft stems', tracks: 15, colors: ['#d8f3dc', '#74c69d'] },
        { title: 'night spinach', tracks: 51, colors: ['#52b788', '#081c15'] },
        { title: 'tiny vines', tracks: 24, colors: ['#b7e4c7', '#40916c'] },
        { title: 'fern machine', tracks: 39, colors: ['#95d5b2', '#2d6a4f'] },
    ],
    albums: [
        { title: 'photosynthesis', tracks: 12, colors: ['#d8f3dc', '#52b788'] },
        { title: 'kitchen garden', tracks: 9, colors: ['#b7e4c7', '#40916c'] },
        { title: 'chlorophyll hum', tracks: 14, colors: ['#95d5b2', '#1b4332'] },
        { title: 'rain jar', tracks: 11, colors: ['#74c69d', '#2d6a4f'] },
        { title: 'sprout signals', tracks: 16, colors: ['#d8f3dc', '#40916c'] },
        { title: 'soil memory', tracks: 10, colors: ['#95d5b2', '#081c15'] },
        { title: 'greenhouse tape', tracks: 13, colors: ['#b7e4c7', '#52b788'] },
        { title: 'leaf language', tracks: 8, colors: ['#74c69d', '#1b4332'] },
    ],
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

const createDeckCard = ({ title, tracks, colors }, index = 0) => {
    const card = document.createElement('article');
    const tilts = ['-1deg', '1.2deg', '-0.35deg', '0.75deg'];
    const tilt = tilts[index % tilts.length];
    card.className = 'library-card';
    card.dataset.tilt = tilt;
    card.style.setProperty('--card-tilt', tilt);
    card.style.setProperty('--cover-a', colors[0]);
    card.style.setProperty('--cover-b', colors[1]);
    card.innerHTML = `
        <h3 class="library-card-title">${title}</h3>
        <div class="library-card-cover" aria-hidden="true"></div>
        <span class="library-card-count">${tracks} tracks</span>
    `;
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
    if (!deckLoopWidth || !deckCardStep || !deckSlotCards.length) {
        return;
    }

    const offset = modulo(deckCurrentOffset, deckLoopWidth);

    deckSlotCards.forEach((card, index) => {
        const x = modulo((index * deckCardStep) - offset + deckBuffer, deckLoopWidth) - deckBuffer;
        card.style.transform = `translate3d(${x}px, 0, 0) rotate(${card.dataset.tilt})`;
    });
};

const measureDeckLoop = () => {
    if (!libraryDeck || !libraryDeckTrack || !deckMode) {
        return;
    }

    const { step } = getDeckCardMetrics();
    const baseCount = deckCards[deckMode].length;
    const visibleWidth = libraryDeck.clientWidth || window.innerWidth;
    const minimumSlots = Math.ceil((visibleWidth + (step * 4)) / step);
    const slotCount = Math.ceil(minimumSlots / baseCount) * baseCount;

    deckCardStep = step;
    deckBuffer = step * 2;
    deckLoopWidth = slotCount * step;

    libraryDeckTrack.innerHTML = '';
    deckSlotCards = Array.from({ length: slotCount }, (_, index) => {
        const card = createDeckCard(deckCards[deckMode][index % baseCount], index);
        libraryDeckTrack.append(card);
        return card;
    });

    deckCurrentOffset = modulo(deckCurrentOffset, deckLoopWidth);
    deckTargetOffset = deckCurrentOffset;
    applyDeckTransform();
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

    activeLibraryTab = selectedTab;
    animateSubtitleOut();
    renderLibraryDeck(selectedTab.dataset.libraryTab);

    flipElementToState(nowPlayingBar, () => {
        document.body.classList.add('library-mode');
        libraryTabs.classList.add('is-focused');
        libraryTabs.dataset.activeTab = selectedTab.dataset.libraryTab;

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

window.addEventListener('resize', () => {
    if (activeLibraryTab) {
        animateTabsToCenter(activeLibraryTab);
        measureDeckLoop();
    }
});
