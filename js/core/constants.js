export const PLAYER_SOURCES = Object.freeze({
    NAVIDROME: 'navidrome',
    MPRIS: 'mpris',
});

export const STORAGE_KEYS = Object.freeze({
    NAVIDROME_CONNECTION: 'spinachMusic.navidromeConnection',
    ONBOARDING_SKIPPED: 'spinachMusic.onboardingSkipped',
    PLAYER_SOURCE: 'spinachMusic.playerSource',
    VOLUME: 'spinachMusic.volume',
    NAVIDROME_PLAYER_STATE: 'spinachMusic.navidromePlayerState',
    FETCH_TRACK_COVERS: 'spinachMusic.fetchTrackCovers',
    HIGH_RES_BACKGROUND_COVERS: 'spinachMusic.highResBackgroundCovers',
    BACKGROUND_COVER_QUALITY: 'spinachMusic.backgroundCoverQuality',
    ADAPTIVE_COVER_COLORS: 'spinachMusic.adaptiveCoverColors',
    COVER_BACKGROUND: 'spinachMusic.coverBackground',
    LAST_SONG: 'spinachMusic.lastSong',
});

export const EVENT_NAMES = Object.freeze({
    ADVANCED_SETTINGS_CHANGED: 'spinach:advanced-settings-changed',
    CACHE_CLEARED: 'spinach:cache-cleared',
    NAVIDROME_CONNECTION_CHANGE: 'spinach:navidrome-connection-change',
    PLAYER_MESSAGE: 'spinach:player-message',
    PLAYER_SOURCE_CHANGE: 'spinach:player-source-change',
    PLAYER_STATE: 'spinach:player-state',
});

export const ENDPOINTS = Object.freeze({
    LYRICS: '/lyrics',
    MPRIS: '/mpris',
    MPRIS_ART: '/mpris/art',
    MPRIS_CONTROL: '/mpris/control',
    NAVIDROME_COVER: '/navidrome/cover',
    NAVIDROME_CACHE_COVER: '/navidrome/cache-cover',
    NAVIDROME_LIBRARY: '/navidrome/library',
    NAVIDROME_LYRICS: '/navidrome/lyrics',
    NAVIDROME_STREAM: '/navidrome/stream',
    NAVIDROME_TRACKS: '/navidrome/tracks',
    CACHE_COVERS_CLEAR: '/cache/covers/clear',
    CACHE_PALETTES_CLEAR: '/cache/palettes/clear',
});

export const BACKGROUND_COVER_QUALITIES = Object.freeze({
    GREAT: 'great',
    AMAZING: 'amazing',
    MAX: 'max',
});

export const DEFAULTS = Object.freeze({
    NAVIDROME_URL: 'http://127.0.0.1:4533/',
    PLAYER_SOURCE: PLAYER_SOURCES.NAVIDROME,
    VOLUME: 0.60,
    BACKGROUND_COVER_QUALITY: BACKGROUND_COVER_QUALITIES.GREAT,
});

export const SUBSONIC_CLIENT = Object.freeze({
    VERSION: '1.16.1',
    NAME: 'spinach-music',
});
