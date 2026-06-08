import { EVENT_NAMES } from '../core/constants.js';
import { listenSpinachEvent } from '../core/events.js';
import { createLibraryAnimationsController, syncViewportVars } from './animations.js';
import { createDeckCard } from './cards.js';
import { createLibraryCoversController } from './covers.js';
import { createLibraryDataController } from './data.js';
import { createLibraryDeckController } from './deck.js';

const elements = {
    libraryTabs: document.querySelector('.library-tabs'),
    libraryTabButtons: document.querySelectorAll('.library-tab'),
    libraryDeck: document.querySelector('.library-deck'),
    libraryDeckTrack: document.querySelector('[data-library-deck-track]'),
    libraryBackButton: document.querySelector('.library-back'),
    libraryProgressTooltip: document.querySelector('.library-progress-tooltip'),
    libraryProgressText: document.querySelector('.library-progress-tooltip span'),
    subtitleText: document.querySelector('.subtitle-txt'),
    nowPlayingBar: document.querySelector('.now-playing-bar'),
};

syncViewportVars();

let activeLibraryTab;
let deck;
let data;

const animations = createLibraryAnimationsController({ elements });
const covers = createLibraryCoversController({
    elements,
    getDeckMode: () => deck?.getMode() || '',
    getLibraryDataRun: () => data?.getDataRun() || 0,
});

const setLibraryBackVisible = (isVisible) => {
    const { libraryBackButton } = elements;
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
    setLibraryBackVisible(document.body.classList.contains('library-mode') && (deck?.getMode() === 'artistAlbums' || deck?.getMode() === 'albumTracks'));
};

data = createLibraryDataController({
    covers,
    getDeckMode: () => deck?.getMode() || '',
    getDeckCurrentOffset: () => deck?.getCurrentOffset() || 0,
    onRefreshDeck: (mode, options) => deck?.refreshIfActive(mode, options),
    onRenderDeck: (mode, options) => deck?.render(mode, options),
});

deck = createLibraryDeckController({
    elements,
    createDeckCard: (item, index) => createDeckCard(item, index, covers),
    getDeckCards: data.getDeckCards,
    updateLibraryBackButton,
});

const closeLibraryMode = () => {
    activeLibraryTab = null;
    data.clearContexts();
    deck.stopMarquees();
    animations.animateSubtitleIn();

    animations.flipNowPlayingToState(() => {
        document.body.classList.remove('library-mode');
        elements.libraryTabs?.classList.remove('is-focused');
        if (elements.libraryTabs) {
            delete elements.libraryTabs.dataset.activeTab;
        }
        document.body.classList.remove('artist-albums-mode', 'album-tracks-mode');
        elements.libraryDeck?.setAttribute('aria-hidden', 'true');
        updateLibraryBackButton();

        elements.libraryTabButtons.forEach((tab) => {
            tab.classList.remove('is-selected', 'is-counterpart');
            tab.setAttribute('aria-selected', 'false');
        });
    });

    animations.animateTabsHome();
};

const openLibraryTab = (selectedTab) => {
    if (activeLibraryTab === selectedTab && document.body.classList.contains('library-mode')) {
        closeLibraryMode();
        return;
    }

    const mode = selectedTab.dataset.libraryTab;
    data.clearContexts();
    activeLibraryTab = selectedTab;
    animations.animateSubtitleOut();
    deck.render(mode);
    data.fetchLibraryMode(mode);

    animations.flipNowPlayingToState(() => {
        document.body.classList.add('library-mode');
        elements.libraryTabs?.classList.add('is-focused');
        if (elements.libraryTabs) {
            elements.libraryTabs.dataset.activeTab = mode;
        }

        elements.libraryTabButtons.forEach((tab) => {
            const isSelected = tab === selectedTab;
            tab.classList.toggle('is-selected', isSelected);
            tab.classList.toggle('is-counterpart', !isSelected);
            tab.setAttribute('aria-selected', isSelected);
        });
    });

    animations.animateTabsToCenter(selectedTab);
};

const playDeckCard = (card) => {
    if (!card || card.classList.contains('is-status-card')) {
        return;
    }

    const itemIndex = Number.parseInt(card.dataset.itemIndex, 10);
    const deckBaseCards = deck.getBaseCards();
    const item = deckBaseCards[itemIndex];
    if (!item) {
        return;
    }

    const deckMode = deck.getMode();
    if (item.type === 'artist' && deckMode === 'artists') {
        data.openArtistAlbums(item);
        return;
    }

    if (item.type === 'album' && (deckMode === 'albums' || deckMode === 'artistAlbums')) {
        data.openAlbumTracks(item);
        return;
    }

    if (item.type === 'song' && deckMode === 'albumTracks') {
        covers.preloadNowPlayingBackground(item, data.getContextState().albumTracksContext || {});
        window.spinachPlayer?.playQueue?.(deckBaseCards.filter((track) => track?.type === 'song'), itemIndex);
        return;
    }

    covers.preloadNowPlayingBackground(item);
    window.spinachPlayer?.playLibraryItem?.(item);
};

elements.libraryTabButtons.forEach((tab) => {
    tab.addEventListener('click', () => openLibraryTab(tab));
});

elements.libraryDeck?.addEventListener('wheel', (event) => {
    event.preventDefault();
    deck.queueScroll(event.deltaY || event.deltaX);
}, { passive: false });

elements.libraryDeckTrack?.addEventListener('pointerover', (event) => {
    const card = event.target.closest('.library-card');

    if (!card || card.contains(event.relatedTarget)) {
        return;
    }

    deck.restartCardMarquee(card, true);
});

elements.libraryDeckTrack?.addEventListener('pointerout', (event) => {
    const card = event.target.closest('.library-card');

    if (!card || card.contains(event.relatedTarget)) {
        return;
    }

    deck.restartCardMarquee(card, false);
});

elements.libraryDeckTrack?.addEventListener('click', (event) => {
    playDeckCard(event.target.closest('.library-card'));
});

elements.libraryBackButton?.addEventListener('click', data.backToPreviousLibraryView);

elements.libraryDeckTrack?.addEventListener('keydown', (event) => {
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

listenSpinachEvent(EVENT_NAMES.ADVANCED_SETTINGS_CHANGED, (event) => {
    const context = data.getContextState().albumTracksContext;
    if (event.detail?.setting !== 'trackCovers' || deck.getMode() !== 'albumTracks' || !context?.id) {
        return;
    }

    data.fetchLibraryMode('albumTracks', true, context);
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
    animations.syncViewportVars();

    if (activeLibraryTab) {
        animations.animateTabsToCenter(activeLibraryTab);
        requestAnimationFrame(deck.measure);
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

listenSpinachEvent(EVENT_NAMES.CACHE_CLEARED, (event) => {
    const cache = event.detail?.cache;
    if (cache !== 'covers' && cache !== 'palettes') {
        return;
    }

    data.handleRuntimeCacheCleared(cache);
});

listenSpinachEvent(EVENT_NAMES.NAVIDROME_CONNECTION_CHANGE, (event) => {
    const connected = event.detail?.connected === true;
    data.resetLibraryDeckData();
    setLibraryBackVisible(false);
    document.body.classList.remove('artist-albums-mode', 'album-tracks-mode');

    if (activeLibraryTab?.dataset.libraryTab) {
        const mode = activeLibraryTab.dataset.libraryTab;
        deck.render(mode, { drop: true });
        if (connected) {
            data.fetchLibraryMode(mode, true);
        }
        return;
    }

    if (connected) {
        data.warmLibraryCache();
    }
});

window.setTimeout(data.warmLibraryCache, 650);
