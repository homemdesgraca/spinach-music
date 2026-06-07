const navidromeUrl = document.querySelector('#navidrome-url');
const navidromeUser = document.querySelector('#navidrome-user');
const navidromePass = document.querySelector('#navidrome-pass');
const navidromeConnect = document.querySelector('#navidrome-connect');
const navidromeStatus = document.querySelector('#navidrome-status');

const STORAGE_KEY = 'spinachMusic.navidromeConnection';
const DEFAULT_NAVIDROME_URL = 'http://127.0.0.1:4533/';
const SUBSONIC_VERSION = '1.16.1';
const CLIENT_NAME = 'spinach-music';

const setStatus = (message, type = '') => {
    navidromeStatus.textContent = message;
    navidromeStatus.className = `connection-status navidrome-status ${type}`.trim();
};

const getErrorMessage = (error) => {
    if (error?.message === 'Failed to fetch') {
        return 'failed to fetch';
    }

    return error?.message || 'failed to fetch';
};

let failedMoodTimeout;
let isNavidromeConnected = false;

const setNavidromeButtonText = (connected = false) => {
    navidromeConnect.innerHTML = connected
        ? 'connected :)<span class="disconnect-hint">disconnect</span>'
        : 'connect';
};

const setConnectButtonMood = (mood = '') => {
    clearTimeout(failedMoodTimeout);
    navidromeConnect.classList.remove('connected', 'failed');

    if (!mood) {
        return;
    }

    void navidromeConnect.offsetWidth;
    navidromeConnect.classList.add(mood);

    if (mood === 'failed') {
        failedMoodTimeout = setTimeout(() => {
            navidromeConnect.classList.remove('failed');
        }, 1000);
    }
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
    if (!connection) {
        navidromeUrl.value = DEFAULT_NAVIDROME_URL;
        return;
    }

    navidromeUrl.value = connection.url || DEFAULT_NAVIDROME_URL;
    navidromeUser.value = connection.username || '';
    navidromePass.value = connection.password || '';
};

const notifyConnectionChange = () => {
    window.dispatchEvent(new CustomEvent('spinach:navidrome-connection-change'));
};

const disconnectNavidrome = () => {
    localStorage.removeItem(STORAGE_KEY);
    isNavidromeConnected = false;
    setConnectButtonMood();
    setNavidromeButtonText(false);
    setStatus('disconnected');
    notifyConnectionChange();
};

const connectNavidrome = async () => {
    if (isNavidromeConnected) {
        disconnectNavidrome();
        return;
    }

    const connection = {
        url: navidromeUrl.value.trim(),
        username: navidromeUser.value.trim(),
        password: navidromePass.value,
    };

    setConnectButtonMood();

    if (!connection.url || !connection.username || !connection.password) {
        setNavidromeButtonText(false);
        setStatus('fill in url, username, and password', 'error');
        setConnectButtonMood('failed');
        return;
    }

    try {
        navidromeConnect.textContent = 'testing...';
        setStatus('testing connection...');
        await fetchSubsonic(connection.url, 'ping', connection);
        saveConnection(connection);
        isNavidromeConnected = true;
        setNavidromeButtonText(true);
        setStatus('', 'ok');
        setConnectButtonMood('connected');
        notifyConnectionChange();
    } catch (error) {
        isNavidromeConnected = false;
        setNavidromeButtonText(false);
        setStatus(getErrorMessage(error), 'error');
        setConnectButtonMood('failed');
    }
};

const savedConnection = loadConnection();
fillConnectionForm(savedConnection);

if (savedConnection?.url && savedConnection?.username && savedConnection?.password) {
    isNavidromeConnected = true;
    setNavidromeButtonText(true);
    setStatus('', 'ok');
    setConnectButtonMood('connected');
}

navidromeConnect.addEventListener('click', connectNavidrome);
