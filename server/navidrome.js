const http = require('http');
const https = require('https');
const { createReadStream } = require('fs');
const {
    fetchRemoteJson,
    firstLine,
    getPrimaryArtist,
    normalizeServerUrl,
    scoreSongMatch,
    sendJson,
} = require('./utils');
const {
    COVER_ART_SIZE,
    COVER_BACKGROUND_HIGH_SIZE,
    COVER_BACKGROUND_SIZE,
    getFirstCachedRemoteArt,
} = require('./covers');

const getNavidromeConnection = (searchParams) => ({
    url: firstLine(searchParams.get('url')),
    username: firstLine(searchParams.get('username')),
    password: firstLine(searchParams.get('password')),
});

const buildNavidromeUrl = (connection, endpoint, params = {}, options = {}) => {
    const url = new URL(`rest/${endpoint}.view`, normalizeServerUrl(connection.url));

    url.searchParams.set('u', connection.username);
    url.searchParams.set('p', connection.password);
    url.searchParams.set('v', '1.16.1');
    url.searchParams.set('c', 'spinach-music');

    if (options.json !== false) {
        url.searchParams.set('f', 'json');
    }

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).length) {
            url.searchParams.set(key, String(value));
        }
    });

    return url;
};

const extractStructuredLyrics = (payload) => {
    const structured = payload?.['subsonic-response']?.lyricsList?.structuredLyrics;
    return Array.isArray(structured) ? structured : (structured ? [structured] : []);
};

const selectStructuredEntry = (entries) => entries.find((entry) => String(entry.kind || '').toLowerCase() === 'main')
    || entries.find((entry) => entry.synced)
    || entries[0]
    || null;

const formatTimeTag = (seconds) => {
    if (!Number.isFinite(seconds)) {
        return '[0:00.00]';
    }

    const total = Math.max(0, seconds);
    const minutes = Math.floor(total / 60);
    const remaining = (total - (minutes * 60)).toFixed(2).padStart(5, '0');
    return `[${minutes}:${remaining}]`;
};

const lineEntriesToLrc = (entries = []) => entries
    .filter((entry) => Number.isFinite(Number(entry.start)) && String(entry.value || '').trim())
    .map((entry) => `${formatTimeTag(Number(entry.start) / 1000)} ${String(entry.value).trim()}`)
    .join('\n');

const normalizePlainLyricsText = (value) => String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

const structuredEntryToLyrics = (entry) => {
    if (!entry) {
        return null;
    }

    const lineEntries = Array.isArray(entry.cueLine) && entry.cueLine.length
        ? entry.cueLine
        : Array.isArray(entry.line) ? entry.line : [];

    const syncedLyrics = lineEntriesToLrc(lineEntries);
    const plainLyrics = normalizePlainLyricsText((Array.isArray(entry.line) && entry.line.length
        ? entry.line
        : lineEntries)
        .map((line) => String(line.value || '').trim())
        .filter(Boolean)
        .join('\n'));

    return {
        source: 'navidrome-structured',
        kind: entry.kind || 'main',
        plainLyrics,
        syncedLyrics,
        displayArtist: entry.displayArtist || '',
        displayTitle: entry.displayTitle || '',
    };
};

const asList = (value) => Array.isArray(value) ? value : value ? [value] : [];

const normalizeLibraryItem = (item, mode, index) => {
    const title = firstLine(item?.name || item?.title || item?.album || 'untitled');
    const artist = firstLine(item?.artist || item?.albumArtist || '');
    const tracks = Number(item?.songCount ?? item?.trackCount ?? item?.childCount ?? item?.albumCount ?? 0);
    const duration = Number(item?.duration);
    const coverArt = firstLine(item?.coverArt || '');
    const imageUrl = firstLine(item?.artistImageUrl || item?.imageUrl || '');

    return {
        id: firstLine(item?.id || `${mode}-${index}`),
        title,
        subtitle: mode === 'albums' ? artist : '',
        tracks: Number.isFinite(tracks) ? tracks : 0,
        duration: Number.isFinite(duration) ? duration : null,
        coverArt,
        imageUrl,
        type: mode === 'albums' ? 'album' : 'artist',
    };
};

const normalizeSongItem = (song, index = 0) => ({
    id: firstLine(song?.id || `song-${index}`),
    title: firstLine(song?.title || song?.name || 'untitled'),
    artist: firstLine(song?.artist || song?.displayArtist || ''),
    album: firstLine(song?.album || ''),
    duration: Number.isFinite(Number(song?.duration)) ? Number(song.duration) : null,
    coverArt: firstLine(song?.coverArt || ''),
    track: Number.isFinite(Number(song?.track)) ? Number(song.track) : index + 1,
    type: 'song',
});

const getNavidromeLibraryItems = async (connection, mode, options = {}) => {
    if (mode === 'artists') {
        const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getArtists').toString());
        const indexes = asList(payload?.['subsonic-response']?.artists?.index);
        return indexes
            .flatMap((index) => asList(index?.artist))
            .map((artist, index) => normalizeLibraryItem(artist, mode, index))
            .filter((artist) => artist.title)
            .sort((a, b) => a.title.localeCompare(b.title));
    }

    if (mode === 'artistAlbums') {
        const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getArtist', { id: options.artistId }).toString());
        return asList(payload?.['subsonic-response']?.artist?.album)
            .map((album, index) => ({
                ...normalizeLibraryItem(album, 'albums', index),
                subtitle: options.artistTitle || firstLine(album?.artist || album?.albumArtist || ''),
            }))
            .filter((album) => album.title)
            .sort((a, b) => a.title.localeCompare(b.title));
    }

    const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getAlbumList2', {
        type: 'alphabeticalByName',
        size: 500,
        offset: 0,
    }).toString());
    return asList(payload?.['subsonic-response']?.albumList2?.album)
        .map((album, index) => normalizeLibraryItem(album, mode, index))
        .filter((album) => album.title)
        .sort((a, b) => a.title.localeCompare(b.title));
};

const sendNavidromeLibrary = async (request, response) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const connection = getNavidromeConnection(searchParams);
    const requestedMode = firstLine(searchParams.get('mode'));
    const mode = requestedMode === 'albums'
        ? 'albums'
        : requestedMode === 'artistAlbums' ? 'artistAlbums' : 'artists';
    const artistId = firstLine(searchParams.get('artistId'));
    const artistTitle = firstLine(searchParams.get('artistTitle'));

    if (!connection.url || !connection.username || !connection.password) {
        sendJson(response, 400, { error: 'missing navidrome connection' });
        return;
    }

    if (mode === 'artistAlbums' && !artistId) {
        sendJson(response, 400, { error: 'missing artist id' });
        return;
    }

    try {
        const items = await getNavidromeLibraryItems(connection, mode, { artistId, artistTitle });
        sendJson(response, 200, { mode, artistId, artistTitle, items });
    } catch (error) {
        sendJson(response, 502, { error: error?.message || 'failed to fetch navidrome library' });
    }
};

const getNavidromeTrackItems = async (connection, type, id, title) => {
    if (type === 'artist') {
        const topPayload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getTopSongs', {
            artist: title,
            count: 60,
        }).toString()).catch(() => null);
        const topSongs = asList(topPayload?.['subsonic-response']?.topSongs?.song)
            .map(normalizeSongItem)
            .filter((song) => song.id && song.title);

        if (topSongs.length) {
            return topSongs;
        }

        const artistPayload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getArtist', { id }).toString());
        const firstAlbum = asList(artistPayload?.['subsonic-response']?.artist?.album)[0];
        if (!firstAlbum?.id) {
            return [];
        }

        const albumPayload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getAlbum', { id: firstAlbum.id }).toString());
        return asList(albumPayload?.['subsonic-response']?.album?.song)
            .map(normalizeSongItem)
            .filter((song) => song.id && song.title);
    }

    const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getAlbum', { id }).toString());
    return asList(payload?.['subsonic-response']?.album?.song)
        .map(normalizeSongItem)
        .filter((song) => song.id && song.title)
        .sort((a, b) => a.track - b.track);
};

const sendNavidromeTracks = async (request, response) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const connection = getNavidromeConnection(searchParams);
    const type = firstLine(searchParams.get('type')) === 'artist' ? 'artist' : 'album';
    const id = firstLine(searchParams.get('id'));
    const title = firstLine(searchParams.get('title'));

    if (!connection.url || !connection.username || !connection.password || !id) {
        sendJson(response, 400, { error: 'missing navidrome connection or item id' });
        return;
    }

    try {
        const tracks = await getNavidromeTrackItems(connection, type, id, title);
        sendJson(response, 200, { type, id, tracks });
    } catch (error) {
        sendJson(response, 502, { error: error?.message || 'failed to fetch navidrome tracks' });
    }
};

const proxyRemoteStream = (remoteUrl, request, response) => new Promise((resolve) => {
    const target = new URL(remoteUrl);
    const client = target.protocol === 'https:' ? https : http;
    const headers = {
        'user-agent': 'spinach-music/1.0',
        accept: request.headers.accept || '*/*',
    };

    if (request.headers.range) {
        headers.range = request.headers.range;
    }

    const proxy = client.request(target, { method: 'GET', headers }, (remoteResponse) => {
        const responseHeaders = {
            'content-type': remoteResponse.headers['content-type'] || 'audio/mpeg',
            'accept-ranges': remoteResponse.headers['accept-ranges'] || 'bytes',
            'cache-control': 'no-store',
        };

        ['content-length', 'content-range', 'etag', 'last-modified'].forEach((header) => {
            if (remoteResponse.headers[header]) {
                responseHeaders[header] = remoteResponse.headers[header];
            }
        });

        response.writeHead(remoteResponse.statusCode || 200, responseHeaders);
        remoteResponse.pipe(response);
        remoteResponse.on('end', resolve);
    });

    proxy.on('error', () => {
        if (!response.headersSent) {
            sendJson(response, 502, { error: 'stream failed' });
        } else {
            response.destroy();
        }
        resolve();
    });

    request.on('aborted', () => proxy.destroy());
    response.on('close', () => proxy.destroy());
    proxy.end();
});

const sendNavidromeStream = async (request, response) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const connection = getNavidromeConnection(searchParams);
    const id = firstLine(searchParams.get('id'));

    if (!connection.url || !connection.username || !connection.password || !id) {
        sendJson(response, 400, { error: 'missing navidrome connection or song id' });
        return;
    }

    const streamUrl = buildNavidromeUrl(connection, 'stream', { id }, { json: false }).toString();
    await proxyRemoteStream(streamUrl, request, response);
};

const getNavidromeCoverTargets = async (request) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const connection = getNavidromeConnection(searchParams);
    const id = firstLine(searchParams.get('id'));
    const coverArt = firstLine(searchParams.get('coverArt'));
    const imageUrl = firstLine(searchParams.get('imageUrl'));
    const type = firstLine(searchParams.get('type'));
    const requestedSize = Number.parseInt(searchParams.get('size'), 10);
    const coverSize = requestedSize === COVER_BACKGROUND_HIGH_SIZE
        ? COVER_BACKGROUND_HIGH_SIZE
        : requestedSize === COVER_BACKGROUND_SIZE ? COVER_BACKGROUND_SIZE : COVER_ART_SIZE;

    if (!connection.url || !connection.username || !connection.password) {
        throw new Error('missing navidrome connection');
    }

    const cachePrefix = `${normalizeServerUrl(connection.url).origin}|${connection.username}|${type}`;
    const targets = [];

    if (coverArt) {
        targets.push({
            artUrl: buildNavidromeUrl(connection, 'getCoverArt', {
                id: coverArt,
                size: coverSize,
            }).toString(),
            cacheKey: `${cachePrefix}|coverArt|${coverArt}|size:${coverSize}`,
        });
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        targets.push({ artUrl: imageUrl, cacheKey: `${cachePrefix}|image|${imageUrl}` });
    }

    if (type === 'artist' && id) {
        try {
            const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getArtistInfo2', {
                id,
                count: 0,
            }).toString());
            const info = payload?.['subsonic-response']?.artistInfo2 || {};
            const remoteImage = firstLine(info.largeImageUrl || info.mediumImageUrl || info.smallImageUrl || '');

            if (remoteImage) {
                targets.push({ artUrl: remoteImage, cacheKey: `${cachePrefix}|artist|${id}|${remoteImage}` });
            }
        } catch {}
    }

    if (targets.length) {
        return targets;
    }

    throw new Error('cover not found');
};

const sendNavidromeCover = async (request, response) => {
    try {
        const targets = await getNavidromeCoverTargets(request);
        const { imagePath, contentType, buffer } = await getFirstCachedRemoteArt(targets);

        response.writeHead(200, {
            'content-type': contentType,
            'cache-control': 'public, max-age=31536000, immutable',
        });

        if (buffer) {
            response.end(buffer);
            return;
        }

        createReadStream(imagePath).pipe(response);
    } catch (error) {
        sendJson(response, error?.message === 'missing navidrome connection' ? 400 : 404, { error: error?.message || 'cover not found' });
    }
};

const sendNavidromeCacheCover = async (request, response) => {
    try {
        const targets = await getNavidromeCoverTargets(request);
        const { palette } = await getFirstCachedRemoteArt(targets);
        sendJson(response, 200, { ok: true, palette, paletteKey: palette?.paletteKey || '' });
    } catch (error) {
        if (error?.message === 'missing navidrome connection') {
            sendJson(response, 400, { ok: false, error: error.message });
            return;
        }

        sendJson(response, 200, { ok: false, found: false, error: error?.message || 'cover not found' });
    }
};

const resolveNavidromeSongId = async (connection, title, artist, album) => {
    const searchTerms = [title, artist, album].filter(Boolean).join(' ');
    const artistVariants = [...new Set([artist, getPrimaryArtist(artist)])].filter(Boolean);
    const queries = [searchTerms, `${title} ${artist}`.trim(), `${title} ${artistVariants[0] || ''}`.trim()].filter(Boolean);

    for (const query of queries) {
        try {
            const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'search3', {
                query,
                songCount: 12,
                artistCount: 0,
                albumCount: 0,
            }).toString());

            const songs = payload?.['subsonic-response']?.searchResult3?.song;
            const list = Array.isArray(songs) ? songs : songs ? [songs] : [];
            if (!list.length) {
                continue;
            }

            const ranked = list
                .map((song) => ({ song, score: scoreSongMatch(song, title, artist, album) }))
                .sort((a, b) => b.score - a.score);

            if (ranked[0]?.score >= 5) {
                return ranked[0].song.id;
            }
        } catch {}
    }

    return '';
};

const sendNavidromeLyrics = async (request, response) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const connection = getNavidromeConnection(searchParams);
    const title = firstLine(searchParams.get('title'));
    const artist = firstLine(searchParams.get('artist'));
    const album = firstLine(searchParams.get('album'));
    const duration = Number.parseFloat(searchParams.get('duration'));

    if (!connection.url || !connection.username || !connection.password || !title || !artist) {
        sendJson(response, 400, { error: 'missing navidrome connection or song info' });
        return;
    }

    try {
        const songId = await resolveNavidromeSongId(connection, title, artist, album);
        if (!songId) {
            throw new Error('song not found');
        }

        const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getLyricsBySongId', {
            id: songId,
            enhanced: 'true',
        }).toString());

        const structured = extractStructuredLyrics(payload);
        const chosen = selectStructuredEntry(structured);
        const normalized = structuredEntryToLyrics(chosen);

        if (normalized?.syncedLyrics || normalized?.plainLyrics) {
            sendJson(response, 200, {
                ...normalized,
                source: 'navidrome-structured',
                songId,
            });
            return;
        }

        const plain = await fetchRemoteJson(buildNavidromeUrl(connection, 'getLyrics', {
            title,
            artist,
            album,
        }).toString());
        const text = normalizePlainLyricsText(plain?.['subsonic-response']?.lyrics?.value || plain?.['subsonic-response']?.lyrics?.text || '');

        if (text) {
            sendJson(response, 200, {
                source: 'navidrome-plain',
                plainLyrics: text,
                syncedLyrics: '',
                songId,
            });
            return;
        }

        sendJson(response, 200, { ok: false, found: false, error: 'lyrics not found' });
    } catch {
        try {
            const plain = await fetchRemoteJson(buildNavidromeUrl(connection, 'getLyrics', {
                title,
                artist,
                album,
            }).toString());
            const text = normalizePlainLyricsText(plain?.['subsonic-response']?.lyrics?.value || plain?.['subsonic-response']?.lyrics?.text || '');

            if (text) {
                sendJson(response, 200, {
                    source: 'navidrome-plain',
                    plainLyrics: text,
                    syncedLyrics: '',
                });
                return;
            }
        } catch {}

        sendJson(response, 200, { ok: false, found: false, error: 'lyrics not found' });
    }
};

module.exports = {
    sendNavidromeLibrary,
    sendNavidromeTracks,
    sendNavidromeStream,
    sendNavidromeCover,
    sendNavidromeCacheCover,
    sendNavidromeLyrics,
};
