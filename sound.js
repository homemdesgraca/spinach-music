import { EVENT_NAMES } from './js/core/constants.js';
import { emitSpinachEvent, listenSpinachEvent } from './js/core/events.js';
import { getPlayerSource, setPlayerSource as savePlayerSource } from './js/core/storage.js';

const sourceButtons = document.querySelectorAll('[data-player-source]');

const setSourceButtons = (source = getPlayerSource()) => {
    sourceButtons.forEach((button) => {
        const isActive = button.dataset.playerSource === source;
        button.classList.toggle('is-on', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
};

const setPlayerSource = (source) => {
    const nextSource = savePlayerSource(source);
    setSourceButtons(nextSource);
    emitSpinachEvent(EVENT_NAMES.PLAYER_SOURCE_CHANGE, { source: nextSource });
};

sourceButtons.forEach((button) => {
    button.addEventListener('click', () => setPlayerSource(button.dataset.playerSource));
});

listenSpinachEvent(EVENT_NAMES.PLAYER_SOURCE_CHANGE, (event) => {
    setSourceButtons(event.detail?.source || getPlayerSource());
});

setSourceButtons();
