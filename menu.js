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
const ADVANCED_TRACK_COVER_STORAGE_KEY = 'spinachMusic.fetchTrackCovers';
const ADVANCED_BACKGROUND_COVER_STORAGE_KEY = 'spinachMusic.highResBackgroundCovers';

const closeConfigMenu = () => {
    configMenu.classList.remove('open');
    configButton.setAttribute('aria-expanded', 'false');
};

const closeThemePanel = () => {
    themePanel.classList.remove('open');
    themePanel.setAttribute('aria-hidden', 'true');
};

const closeSoundPanel = () => {
    soundPanel.classList.remove('open');
    soundPanel.setAttribute('aria-hidden', 'true');
};

const closeAdvancedPanel = () => {
    advancedPanel.classList.remove('open');
    advancedPanel.setAttribute('aria-hidden', 'true');
};

const closeConnectionsPanel = () => {
    connectionsPanel.classList.remove('open');
    connectionsPanel.setAttribute('aria-hidden', 'true');
};

const openThemePanel = () => {
    closeConnectionsPanel();
    closeSoundPanel();
    closeAdvancedPanel();
    themePanel.classList.add('open');
    themePanel.setAttribute('aria-hidden', 'false');
    closeConfigMenu();
};

const openSoundPanel = () => {
    closeConnectionsPanel();
    closeThemePanel();
    closeAdvancedPanel();
    soundPanel.classList.add('open');
    soundPanel.setAttribute('aria-hidden', 'false');
    closeConfigMenu();
};

const openAdvancedPanel = () => {
    closeConnectionsPanel();
    closeThemePanel();
    closeSoundPanel();
    advancedPanel.classList.add('open');
    advancedPanel.setAttribute('aria-hidden', 'false');
    closeConfigMenu();
};

const openConnectionsPanel = () => {
    closeThemePanel();
    closeSoundPanel();
    closeAdvancedPanel();
    connectionsPanel.classList.add('open');
    connectionsPanel.setAttribute('aria-hidden', 'false');
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

setAdvancedToggle(trackCoverToggle, localStorage.getItem(ADVANCED_TRACK_COVER_STORAGE_KEY) === 'true');
setAdvancedToggle(backgroundCoverToggle, localStorage.getItem(ADVANCED_BACKGROUND_COVER_STORAGE_KEY) === 'true');

trackCoverToggle?.addEventListener('click', () => {
    const enabled = trackCoverToggle.getAttribute('aria-pressed') !== 'true';
    localStorage.setItem(ADVANCED_TRACK_COVER_STORAGE_KEY, String(enabled));
    setAdvancedToggle(trackCoverToggle, enabled);
    window.dispatchEvent(new CustomEvent('spinach:advanced-settings-changed', {
        detail: { setting: 'trackCovers', enabled },
    }));
});

backgroundCoverToggle?.addEventListener('click', () => {
    const enabled = backgroundCoverToggle.getAttribute('aria-pressed') !== 'true';
    localStorage.setItem(ADVANCED_BACKGROUND_COVER_STORAGE_KEY, String(enabled));
    setAdvancedToggle(backgroundCoverToggle, enabled);
    window.dispatchEvent(new CustomEvent('spinach:advanced-settings-changed', {
        detail: { setting: 'backgroundCovers', enabled },
    }));
});

themeButton.addEventListener('click', openThemePanel);
soundButton.addEventListener('click', openSoundPanel);
advancedButton.addEventListener('click', openAdvancedPanel);
connectionsButton.addEventListener('click', openConnectionsPanel);
themeClose.addEventListener('click', closeThemePanel);
soundClose.addEventListener('click', closeSoundPanel);
advancedClose.addEventListener('click', closeAdvancedPanel);
panelClose.addEventListener('click', closeConnectionsPanel);
