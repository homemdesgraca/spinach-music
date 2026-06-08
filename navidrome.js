import { DEFAULTS, EVENT_NAMES, STORAGE_KEYS, SUBSONIC_CLIENT } from './js/core/constants.js';
import { emitSpinachEvent } from './js/core/events.js';
import {
    getStorageBoolean,
    loadNavidromeConnection,
    removeStorageValue,
    saveNavidromeConnection,
    setStorageBoolean,
} from './js/core/storage.js';

const navidromeUrl = document.querySelector('#navidrome-url');
const navidromeUser = document.querySelector('#navidrome-user');
const navidromePass = document.querySelector('#navidrome-pass');
const navidromeConnect = document.querySelector('#navidrome-connect');
const navidromeStatus = document.querySelector('#navidrome-status');
const onboardingPanel = document.querySelector('.onboarding-panel');
const onboardingUrl = document.querySelector('#onboarding-navidrome-url');
const onboardingUser = document.querySelector('#onboarding-navidrome-user');
const onboardingPass = document.querySelector('#onboarding-navidrome-pass');
const onboardingConnect = document.querySelector('#onboarding-navidrome-connect');
const onboardingStatus = document.querySelector('#onboarding-navidrome-status');
const onboardingSkip = document.querySelector('.onboarding-skip');

const STORAGE_KEY = STORAGE_KEYS.NAVIDROME_CONNECTION;
const ONBOARDING_SKIPPED_KEY = STORAGE_KEYS.ONBOARDING_SKIPPED;
const DEFAULT_NAVIDROME_URL = DEFAULTS.NAVIDROME_URL;
const SUBSONIC_VERSION = SUBSONIC_CLIENT.VERSION;
const CLIENT_NAME = SUBSONIC_CLIENT.NAME;

const setStatusText = (statusElement, message, type = '') => {
    if (!statusElement) {
        return;
    }

    statusElement.textContent = message;
    statusElement.className = `connection-status navidrome-status ${type}`.trim();
};

const setStatus = (message, type = '') => setStatusText(navidromeStatus, message, type);
const setOnboardingStatus = (message, type = '') => setStatusText(onboardingStatus, message, type);

const getErrorMessage = (error) => {
    if (error?.message === 'Failed to fetch') {
        return 'failed to fetch';
    }

    return (error?.message || 'failed to fetch').toLowerCase();
};

let failedMoodTimeout;
let isNavidromeConnected = false;

const setNavidromeButtonText = (connected = false, button = navidromeConnect) => {
    if (!button) {
        return;
    }

    button.innerHTML = connected
        ? 'connected :)<span class="disconnect-hint">disconnect</span>'
        : 'connect';
};

const setAllNavidromeButtonText = (connected = false) => {
    setNavidromeButtonText(connected, navidromeConnect);
    setNavidromeButtonText(connected, onboardingConnect);
};

const setConnectButtonMood = (mood = '', button = navidromeConnect) => {
    if (!button) {
        return;
    }

    clearTimeout(failedMoodTimeout);
    button.classList.remove('connected', 'failed');

    if (!mood) {
        return;
    }

    void button.offsetWidth;
    button.classList.add(mood);

    if (mood === 'failed') {
        failedMoodTimeout = setTimeout(() => {
            button.classList.remove('failed');
        }, 420);
    }
};

const setAllConnectButtonMoods = (mood = '') => {
    setConnectButtonMood(mood, navidromeConnect);
    setConnectButtonMood(mood, onboardingConnect);
};

const normalizeServerUrl = (rawUrl) => {
    const normalized = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
        ? rawUrl
        : `https://${rawUrl}`;

    const baseUrl = new URL(normalized);
    if (!baseUrl.pathname.endsWith('/')) {
        baseUrl.pathname += '/';
    }

    return baseUrl;
};

const buildRestUrl = (rawUrl, endpoint, credentials, params = {}) => {
    const restUrl = new URL(`rest/${endpoint}.view`, normalizeServerUrl(rawUrl));

    restUrl.searchParams.set('u', credentials.username);
    restUrl.searchParams.set('p', credentials.password);
    restUrl.searchParams.set('v', SUBSONIC_VERSION);
    restUrl.searchParams.set('c', CLIENT_NAME);
    restUrl.searchParams.set('f', 'json');

    Object.entries(params).forEach(([key, value]) => {
        restUrl.searchParams.set(key, value);
    });

    return restUrl;
};

const fetchSubsonic = async (url, endpoint, credentials, params) => {
    const response = await fetch(buildRestUrl(url, endpoint, credentials, params).toString());
    const data = await response.json();
    const subsonic = data?.['subsonic-response'];

    if (!response.ok || subsonic?.status !== 'ok') {
        throw new Error(subsonic?.error?.message || 'failed to fetch');
    }

    return subsonic;
};

const saveConnection = saveNavidromeConnection;

const loadConnection = loadNavidromeConnection;

const fillConnectionForm = (connection) => {
    const url = connection?.url || DEFAULT_NAVIDROME_URL;
    const username = connection?.username || '';
    const password = connection?.password || '';

    navidromeUrl.value = url;
    navidromeUser.value = username;
    navidromePass.value = password;

    if (onboardingUrl) {
        onboardingUrl.value = url;
    }
    if (onboardingUser) {
        onboardingUser.value = username;
    }
    if (onboardingPass) {
        onboardingPass.value = password;
    }
};

const notifyConnectionChange = () => {
    emitSpinachEvent(EVENT_NAMES.NAVIDROME_CONNECTION_CHANGE, {
        connected: hasCompleteConnection(loadConnection()),
    });
};

const hasCompleteConnection = (connection) => Boolean(connection?.url && connection?.username && connection?.password);

const setOnboardingActive = (active) => {
    document.documentElement.classList.toggle('onboarding-active', active);
    document.body.classList.toggle('onboarding-active', active);
    onboardingPanel?.setAttribute('aria-hidden', String(!active));

    if (active) {
        onboardingPanel?.removeAttribute('inert');
        window.setTimeout(() => onboardingUrl?.focus({ preventScroll: true }), 280);
        return;
    }

    onboardingPanel?.setAttribute('inert', '');
};

const refreshOnboardingState = () => {
    const skipped = getStorageBoolean(ONBOARDING_SKIPPED_KEY);
    setOnboardingActive(!hasCompleteConnection(loadConnection()) && !skipped);
};

const readConnectionForm = (source = 'panel') => {
    const useOnboarding = source === 'onboarding';

    return {
        url: (useOnboarding ? onboardingUrl?.value : navidromeUrl.value)?.trim() || '',
        username: (useOnboarding ? onboardingUser?.value : navidromeUser.value)?.trim() || '',
        password: (useOnboarding ? onboardingPass?.value : navidromePass.value) || '',
    };
};

const disconnectNavidrome = () => {
    removeStorageValue(STORAGE_KEY);
    removeStorageValue(ONBOARDING_SKIPPED_KEY);
    isNavidromeConnected = false;
    fillConnectionForm(null);
    setAllConnectButtonMoods();
    setAllNavidromeButtonText(false);
    setStatus('disconnected');
    setOnboardingStatus('disconnected');
    refreshOnboardingState();
    notifyConnectionChange();
};

const connectNavidrome = async (source = 'panel') => {
    if (isNavidromeConnected && source !== 'onboarding') {
        disconnectNavidrome();
        return;
    }

    const connection = readConnectionForm(source);
    const activeButton = source === 'onboarding' ? onboardingConnect : navidromeConnect;
    const activeStatus = source === 'onboarding' ? setOnboardingStatus : setStatus;

    setConnectButtonMood('', activeButton);

    if (!connection.url || !connection.username || !connection.password) {
        setNavidromeButtonText(false, activeButton);
        activeStatus('fill in url, username, and password', 'error');
        setConnectButtonMood('failed', activeButton);
        return;
    }

    try {
        activeButton.textContent = 'testing...';
        activeStatus('testing connection...');
        await fetchSubsonic(connection.url, 'ping', connection);
        saveConnection(connection);
        removeStorageValue(ONBOARDING_SKIPPED_KEY);
        fillConnectionForm(connection);
        isNavidromeConnected = true;
        setAllNavidromeButtonText(true);
        setStatus('', 'ok');
        setOnboardingStatus('', 'ok');
        setConnectButtonMood('connected', activeButton);
        setOnboardingActive(false);
        notifyConnectionChange();
    } catch (error) {
        isNavidromeConnected = false;
        setNavidromeButtonText(false, activeButton);
        activeStatus(getErrorMessage(error), 'error');
        setConnectButtonMood('failed', activeButton);
    }
};

const savedConnection = loadConnection();
fillConnectionForm(savedConnection);

if (hasCompleteConnection(savedConnection)) {
    isNavidromeConnected = true;
    setAllNavidromeButtonText(true);
    setStatus('', 'ok');
    setOnboardingStatus('', 'ok');
    setAllConnectButtonMoods('connected');
}

refreshOnboardingState();

navidromeConnect.addEventListener('click', () => connectNavidrome('panel'));
onboardingConnect?.addEventListener('click', () => connectNavidrome('onboarding'));
onboardingSkip?.addEventListener('click', () => {
    setStorageBoolean(ONBOARDING_SKIPPED_KEY, true);
    setOnboardingActive(false);
});

[onboardingUrl, onboardingUser, onboardingPass].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            connectNavidrome('onboarding');
        }
    });
});
