import { DEFAULTS, PLAYER_SOURCES, STORAGE_KEYS } from './constants.js';

export const getStorageValue = (key, fallback = '') => {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
};

export const setStorageValue = (key, value) => {
    localStorage.setItem(key, value);
};

export const removeStorageValue = (key) => {
    localStorage.removeItem(key);
};

export const getStorageJson = (key, fallback = null) => {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    } catch {
        return fallback;
    }
};

export const setStorageJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
};

export const getStorageBoolean = (key, fallback = false) => {
    const value = getStorageValue(key, null);
    return value === null ? fallback : value === 'true';
};

export const setStorageBoolean = (key, value) => {
    setStorageValue(key, String(Boolean(value)));
};

export const normalizePlayerSource = (source) => (
    source === PLAYER_SOURCES.MPRIS ? PLAYER_SOURCES.MPRIS : DEFAULTS.PLAYER_SOURCE
);

export const getPlayerSource = () => normalizePlayerSource(getStorageValue(STORAGE_KEYS.PLAYER_SOURCE, DEFAULTS.PLAYER_SOURCE));

export const setPlayerSource = (source) => {
    const normalized = normalizePlayerSource(source);
    setStorageValue(STORAGE_KEYS.PLAYER_SOURCE, normalized);
    return normalized;
};

export const loadNavidromeConnection = () => getStorageJson(STORAGE_KEYS.NAVIDROME_CONNECTION, null);

export const saveNavidromeConnection = (connection) => {
    setStorageJson(STORAGE_KEYS.NAVIDROME_CONNECTION, connection);
};

export const hasCompleteNavidromeConnection = (connection = loadNavidromeConnection()) => Boolean(
    connection?.url && connection?.username && connection?.password
);
