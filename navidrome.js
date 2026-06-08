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

const STORAGE_KEY = 'spinachMusic.navidromeConnection';
const ONBOARDING_SKIPPED_KEY = 'spinachMusic.onboardingSkipped';
const DEFAULT_NAVIDROME_URL = 'http://127.0.0.1:4533/';
const SUBSONIC_VERSION = '1.16.1';
const CLIENT_NAME = 'spinach-music';

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

const saveConnection = (connection) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
};

const loadConnection = () => {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
};

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
    window.dispatchEvent(new CustomEvent('spinach:navidrome-connection-change'));
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
    const skipped = localStorage.getItem(ONBOARDING_SKIPPED_KEY) === 'true';
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
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
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
        localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
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
    localStorage.setItem(ONBOARDING_SKIPPED_KEY, 'true');
    setOnboardingActive(false);
});

[onboardingUrl, onboardingUser, onboardingPass].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            connectNavidrome('onboarding');
        }
    });
});
