const PLAYER_SOURCE_STORAGE_KEY = 'spinachMusic.playerSource';
const DEFAULT_PLAYER_SOURCE = 'navidrome';
const sourceButtons = document.querySelectorAll('[data-player-source]');

const getPlayerSource = () => (
    localStorage.getItem(PLAYER_SOURCE_STORAGE_KEY) === 'mpris'
        ? 'mpris'
        : DEFAULT_PLAYER_SOURCE
);

const setSourceButtons = (source = getPlayerSource()) => {
    sourceButtons.forEach((button) => {
        const isActive = button.dataset.playerSource === source;
        button.classList.toggle('is-on', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
};

const setPlayerSource = (source) => {
    const nextSource = source === 'mpris' ? 'mpris' : DEFAULT_PLAYER_SOURCE;
    localStorage.setItem(PLAYER_SOURCE_STORAGE_KEY, nextSource);
    setSourceButtons(nextSource);
    window.dispatchEvent(new CustomEvent('spinach:player-source-change', {
        detail: { source: nextSource },
    }));
};

sourceButtons.forEach((button) => {
    button.addEventListener('click', () => setPlayerSource(button.dataset.playerSource));
});

window.addEventListener('spinach:player-source-change', (event) => {
    setSourceButtons(event.detail?.source || getPlayerSource());
});

setSourceButtons();
