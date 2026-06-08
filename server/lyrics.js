const { fetchRemoteJson, firstFulfilled, firstLine, getPrimaryArtist, sendJson } = require('./utils');

const LYRICS_CACHE_TTL = 1000 * 60 * 60 * 24;
const lyricsCache = new Map();

const getLyricsCacheKey = ({ title, artist, album, duration }) => [title, artist, album, Math.round(duration || 0)]
    .map((value) => String(value || '').trim().toLowerCase())
    .join('|');

const getCachedLyrics = (key) => {
    const cached = lyricsCache.get(key);

    if (!cached) {
        return null;
    }

    if (Date.now() - cached.cachedAt > LYRICS_CACHE_TTL) {
        lyricsCache.delete(key);
        return null;
    }

    return cached.payload;
};

const setCachedLyrics = (key, payload) => {
    lyricsCache.set(key, { cachedAt: Date.now(), payload });
};

const buildLyricsParams = ({ title, artist, album, duration }, includeDuration = true) => {
    const params = new URLSearchParams({
        track_name: title,
        artist_name: artist,
    });

    if (album) {
        params.set('album_name', album);
    }

    if (includeDuration && Number.isFinite(duration) && duration > 0) {
        params.set('duration', String(Math.round(duration)));
    }

    return params;
};

const pickLyricsMatch = (results, duration) => {
    if (!Array.isArray(results) || !results.length) {
        return null;
    }

    const closeDuration = results.filter((item) => (
        Number.isFinite(duration)
        && Number.isFinite(Number(item.duration))
        && Math.abs(Number(item.duration) - duration) <= 3
    ));

    const candidates = closeDuration.length ? closeDuration : results;
    return candidates.find((item) => item.syncedLyrics) || candidates[0];
};

const sendLyrics = async (request, response) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const title = firstLine(searchParams.get('title'));
    const artist = firstLine(searchParams.get('artist'));
    const album = firstLine(searchParams.get('album'));
    const duration = Number.parseFloat(searchParams.get('duration'));

    if (!title || !artist) {
        sendJson(response, 400, { error: 'missing song info' });
        return;
    }

    const lyricsCacheKey = getLyricsCacheKey({ title, artist, album, duration });
    const cachedLyrics = getCachedLyrics(lyricsCacheKey);
    if (cachedLyrics) {
        sendJson(response, 200, { ...cachedLyrics, cached: true });
        return;
    }

    const artistVariants = [...new Set([artist, getPrimaryArtist(artist)].filter(Boolean))];
    const fetchAndCache = async (payloadPromise) => {
        const payload = await payloadPromise;
        setCachedLyrics(lyricsCacheKey, payload);
        sendJson(response, 200, payload);
    };

    try {
        await fetchAndCache(firstFulfilled(artistVariants.map((artistName) => {
            const params = buildLyricsParams({ title, artist: artistName, album, duration });
            return fetchRemoteJson(`https://lrclib.net/api/get-cached?${params}`);
        })));
        return;
    } catch {}

    try {
        await fetchAndCache(firstFulfilled(artistVariants.map((artistName) => {
            const params = buildLyricsParams({ title, artist: artistName, album, duration });
            return fetchRemoteJson(`https://lrclib.net/api/get?${params}`);
        })));
        return;
    } catch {}

    try {
        await fetchAndCache(firstFulfilled(artistVariants.map(async (artistName) => {
            const params = buildLyricsParams({ title, artist: artistName, album, duration }, false);
            const match = pickLyricsMatch(await fetchRemoteJson(`https://lrclib.net/api/search?${params}`), duration);

            if (!match) {
                throw new Error('lyrics not found');
            }

            return match;
        })));
        return;
    } catch {}

    try {
        const params = new URLSearchParams({ q: `${title} ${artist} ${album}`.trim() });
        const match = pickLyricsMatch(await fetchRemoteJson(`https://lrclib.net/api/search?${params}`), duration);

        if (match) {
            setCachedLyrics(lyricsCacheKey, match);
            sendJson(response, 200, match);
            return;
        }
    } catch {}

    sendJson(response, 200, { ok: false, found: false, error: 'lyrics not found' });
};

module.exports = {
    sendLyrics,
};
