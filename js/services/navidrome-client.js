import { ENDPOINTS, STORAGE_KEYS, SUBSONIC_CLIENT } from '../core/constants.js';
import {
    getStorageJson,
    removeStorageValue,
    setStorageJson,
} from '../core/storage.js';

export const loadNavidromeConnection = () => getStorageJson(STORAGE_KEYS.NAVIDROME_CONNECTION, null);

export const saveNavidromeConnection = (connection) => {
    setStorageJson(STORAGE_KEYS.NAVIDROME_CONNECTION, connection);
};

export const hasCompleteNavidromeConnection = (connection = loadNavidromeConnection()) => Boolean(
    connection?.url && connection?.username && connection?.password
);

export const removeNavidromeConnection = () => {
    removeStorageValue(STORAGE_KEYS.NAVIDROME_CONNECTION);
};

export const normalizeServerUrl = (rawUrl = '') => {
    const value = String(rawUrl).trim();
    const normalized = value.startsWith('http://') || value.startsWith('https://')
        ? value
        : `https://${value}`;

    const baseUrl = new URL(normalized);
    if (!baseUrl.pathname.endsWith('/')) {
        baseUrl.pathname += '/';
    }

    return baseUrl;
};

export const buildSubsonicRestUrl = (rawUrl, endpoint, credentials, params = {}) => {
    const restUrl = new URL(`rest/${endpoint}.view`, normalizeServerUrl(rawUrl));

    restUrl.searchParams.set('u', credentials.username);
    restUrl.searchParams.set('p', credentials.password);
    restUrl.searchParams.set('v', SUBSONIC_CLIENT.VERSION);
    restUrl.searchParams.set('c', SUBSONIC_CLIENT.NAME);
    restUrl.searchParams.set('f', 'json');

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            restUrl.searchParams.set(key, value);
        }
    });

    return restUrl;
};

export const fetchSubsonic = async (url, endpoint, credentials, params = {}) => {
    const response = await fetch(buildSubsonicRestUrl(url, endpoint, credentials, params).toString());
    const data = await response.json();
    const subsonic = data?.['subsonic-response'];

    if (!response.ok || subsonic?.status !== 'ok') {
        throw new Error(subsonic?.error?.message || 'failed to fetch');
    }

    return subsonic;
};

export const validateNavidromeConnection = (connection) => {
    if (!hasCompleteNavidromeConnection(connection)) {
        throw new Error('missing navidrome connection');
    }

    return fetchSubsonic(connection.url, 'ping', connection);
};

export const withNavidromeConnectionParams = (url, connection = loadNavidromeConnection()) => {
    if (!hasCompleteNavidromeConnection(connection)) {
        return null;
    }

    url.searchParams.set('url', connection.url);
    url.searchParams.set('username', connection.username);
    url.searchParams.set('password', connection.password);
    return url;
};

export const buildNavidromeProxyUrl = (endpoint, params = {}, connection = loadNavidromeConnection()) => {
    const url = withNavidromeConnectionParams(new URL(endpoint, window.location.origin), connection);
    if (!url) {
        return null;
    }

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
        }
    });

    return url;
};

export const buildNavidromeLibraryUrl = (mode, context = null) => {
    if ((mode === 'artistAlbums' || mode === 'albumTracks') && !context?.id) {
        return null;
    }

    if (mode === 'albumTracks') {
        return buildNavidromeProxyUrl(ENDPOINTS.NAVIDROME_TRACKS, {
            id: context.id,
            type: 'album',
            title: context.title || '',
        });
    }

    return buildNavidromeProxyUrl(ENDPOINTS.NAVIDROME_LIBRARY, {
        mode,
        artistId: mode === 'artistAlbums' ? context.id : undefined,
        artistTitle: mode === 'artistAlbums' ? (context.title || '') : undefined,
    });
};

export const buildNavidromeTracksUrl = (item) => {
    if (!item?.id) {
        return null;
    }

    return buildNavidromeProxyUrl(ENDPOINTS.NAVIDROME_TRACKS, {
        id: item.id,
        type: item.type === 'artist' ? 'artist' : 'album',
        title: item.title || '',
    });
};

export const buildNavidromeCoverUrl = (item, endpoint = ENDPOINTS.NAVIDROME_COVER, options = {}) => {
    if (!item?.id && !item?.coverArt && !item?.imageUrl) {
        return null;
    }

    return buildNavidromeProxyUrl(endpoint, {
        id: options.id ?? item.id ?? '',
        coverArt: options.coverArt ?? item.coverArt ?? '',
        imageUrl: options.imageUrl ?? item.imageUrl ?? '',
        type: options.type ?? item.type ?? '',
        size: options.size,
    });
};

export const buildNavidromePlayerCoverUrl = (track) => {
    if (!track?.coverArt) {
        return '';
    }

    return buildNavidromeCoverUrl(track, ENDPOINTS.NAVIDROME_COVER, {
        id: track.id || track.coverArt,
        type: 'song',
        size: '768',
    })?.toString() || '';
};

export const buildNavidromeStreamUrl = (track) => {
    if (!track?.id) {
        return '';
    }

    return buildNavidromeProxyUrl(ENDPOINTS.NAVIDROME_STREAM, { id: track.id })?.toString() || '';
};

export const buildNavidromeLyricsUrl = (songData) => {
    if (!songData?.title) {
        return null;
    }

    return buildNavidromeProxyUrl(ENDPOINTS.NAVIDROME_LYRICS, {
        title: songData.title,
        artist: songData.artist || '',
        album: songData.album || '',
        duration: String(songData.duration || ''),
    });
};
