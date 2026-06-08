import { ENDPOINTS, EVENT_NAMES, STORAGE_KEYS } from './js/core/constants.js';
import { emitSpinachEvent } from './js/core/events.js';
import { getStorageBoolean, setStorageBoolean } from './js/core/storage.js';

const configMenu = document.querySelector('.config-menu');
const configButton = document.querySelector('.config-btn');
const configCards = document.querySelectorAll('.config-card');
const connectionsButton = document.querySelector('.connections-btn');
const themeButton = document.querySelector('.theme-btn');
const soundButton = document.querySelector('.sound-btn');
const advancedButton = document.querySelector('.advanced-btn');
const connectionsPanel = document.querySelector('.connections-panel');
const themePanel = document.querySelector('.theme-panel');
const soundPanel = document.querySelector('.sound-panel');
const advancedPanel = document.querySelector('.advanced-panel');
const panelClose = document.querySelector('.panel-close');
const themeClose = document.querySelector('.theme-close');
const soundClose = document.querySelector('.sound-close');
const advancedClose = document.querySelector('.advanced-close');
const trackCoverToggle = document.querySelector('#track-cover-toggle');
const backgroundCoverToggle = document.querySelector('#background-cover-toggle');
const clearCoverCacheButton = document.querySelector('#clear-cover-cache');
const clearPaletteCacheButton = document.querySelector('#clear-palette-cache');
const advancedCacheStatus = document.querySelector('.advanced-cache-status');
const ADVANCED_TRACK_COVER_STORAGE_KEY = STORAGE_KEYS.FETCH_TRACK_COVERS;
const ADVANCED_BACKGROUND_COVER_STORAGE_KEY = STORAGE_KEYS.HIGH_RES_BACKGROUND_COVERS;

const closeConfigMenu = () => {
    configMenu.classList.remove('open');
    configButton.setAttribute('aria-expanded', 'false');
};

const hidePanel = (panel, focusTarget = configButton) => {
    if (!panel) {
        return;
    }

    if (panel.contains(document.activeElement)) {
        focusTarget?.focus({ preventScroll: true });
    }

    panel.classList.remove('open');
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
};

const showPanel = (panel) => {
    panel?.removeAttribute('inert');
    panel?.classList.add('open');
    panel?.setAttribute('aria-hidden', 'false');
};

[themePanel, soundPanel, advancedPanel, connectionsPanel].forEach((panel) => {
    if (!panel?.classList.contains('open')) {
        panel?.setAttribute('inert', '');
    }
});

const closeThemePanel = () => hidePanel(themePanel);

const closeSoundPanel = () => hidePanel(soundPanel);

const closeAdvancedPanel = () => hidePanel(advancedPanel);

const closeConnectionsPanel = () => hidePanel(connectionsPanel);

const openThemePanel = () => {
    closeConnectionsPanel();
    closeSoundPanel();
    closeAdvancedPanel();
    showPanel(themePanel);
    closeConfigMenu();
};

const openSoundPanel = () => {
    closeConnectionsPanel();
    closeThemePanel();
    closeAdvancedPanel();
    showPanel(soundPanel);
    closeConfigMenu();
};

const openAdvancedPanel = () => {
    closeConnectionsPanel();
    closeThemePanel();
    closeSoundPanel();
    showPanel(advancedPanel);
    closeConfigMenu();
};

const openConnectionsPanel = () => {
    closeThemePanel();
    closeSoundPanel();
    closeAdvancedPanel();
    showPanel(connectionsPanel);
    closeConfigMenu();
};

configButton.addEventListener('click', () => {
    const isOpen = configMenu.classList.toggle('open');
    configButton.setAttribute('aria-expanded', isOpen);
});

configCards.forEach((card) => {
    card.addEventListener('click', closeConfigMenu);
});

const setAdvancedToggle = (toggle, enabled) => {
    toggle?.classList.toggle('is-on', enabled);
    toggle?.setAttribute('aria-pressed', String(enabled));
    if (toggle) {
        toggle.textContent = enabled ? 'on' : 'off';
    }
};

setAdvancedToggle(trackCoverToggle, getStorageBoolean(ADVANCED_TRACK_COVER_STORAGE_KEY));
setAdvancedToggle(backgroundCoverToggle, getStorageBoolean(ADVANCED_BACKGROUND_COVER_STORAGE_KEY));

trackCoverToggle?.addEventListener('click', () => {
    const enabled = trackCoverToggle.getAttribute('aria-pressed') !== 'true';
    setStorageBoolean(ADVANCED_TRACK_COVER_STORAGE_KEY, enabled);
    setAdvancedToggle(trackCoverToggle, enabled);
    emitSpinachEvent(EVENT_NAMES.ADVANCED_SETTINGS_CHANGED, { setting: 'trackCovers', enabled });
});

backgroundCoverToggle?.addEventListener('click', () => {
    const enabled = backgroundCoverToggle.getAttribute('aria-pressed') !== 'true';
    setStorageBoolean(ADVANCED_BACKGROUND_COVER_STORAGE_KEY, enabled);
    setAdvancedToggle(backgroundCoverToggle, enabled);
    emitSpinachEvent(EVENT_NAMES.ADVANCED_SETTINGS_CHANGED, { setting: 'backgroundCovers', enabled });
});

const setAdvancedCacheStatus = (message = '', type = '') => {
    if (!advancedCacheStatus) {
        return;
    }

    advancedCacheStatus.textContent = message;
    advancedCacheStatus.className = `advanced-note advanced-cache-status ${type}`.trim();
};

const clearServerCache = async ({ endpoint, label, button, cache }) => {
    if (!button) {
        return;
    }

    button.disabled = true;
    setAdvancedCacheStatus(`clearing ${label}...`);

    try {
        const response = await fetch(endpoint, { method: 'POST' });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || 'cache clear failed');
        }

        const count = Number.isFinite(Number(payload.files)) ? Number(payload.files) : 0;
        setAdvancedCacheStatus(`${label} cleared (${count} files)`, 'ok');
        emitSpinachEvent(EVENT_NAMES.CACHE_CLEARED, { cache, files: count });
    } catch (error) {
        setAdvancedCacheStatus((error?.message || 'cache clear failed').toLowerCase(), 'error');
    } finally {
        button.disabled = false;
    }
};

clearCoverCacheButton?.addEventListener('click', () => clearServerCache({
    endpoint: ENDPOINTS.CACHE_COVERS_CLEAR,
    label: 'cover cache',
    button: clearCoverCacheButton,
    cache: 'covers',
}));

clearPaletteCacheButton?.addEventListener('click', () => clearServerCache({
    endpoint: ENDPOINTS.CACHE_PALETTES_CLEAR,
    label: 'palette cache',
    button: clearPaletteCacheButton,
    cache: 'palettes',
}));

themeButton.addEventListener('click', openThemePanel);
soundButton.addEventListener('click', openSoundPanel);
advancedButton.addEventListener('click', openAdvancedPanel);
connectionsButton.addEventListener('click', openConnectionsPanel);
themeClose.addEventListener('click', closeThemePanel);
soundClose.addEventListener('click', closeSoundPanel);
advancedClose.addEventListener('click', closeAdvancedPanel);
panelClose.addEventListener('click', closeConnectionsPanel);
