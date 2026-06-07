const http = require('http');
const https = require('https');
const { execFile, execFileSync } = require('child_process');
const { mkdir, readFile, writeFile } = require('fs/promises');
const { createReadStream } = require('fs');
const { createHash } = require('crypto');
const { extname, join, normalize } = require('path');
const { fileURLToPath } = require('url');

const PORT = 5500;
const ROOT = __dirname;
const COVER_CACHE_DIR = join(ROOT, '.cache', 'covers');
const COVER_ART_SIZE = 768;
const COVER_BACKGROUND_SIZE = 1600;
const HAS_FILE_COMMAND = (() => {
    try {
        execFileSync('file', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};

const runPlayerctl = (args) => new Promise((resolve) => {
    execFile('playerctl', args, { timeout: 1200 }, (error, stdout) => {
        resolve(error ? '' : stdout.trim());
    });
});

const runCurlJson = (url) => new Promise((resolve, reject) => {
    execFile('curl', ['-fsSL', '--max-time', '8', url], { timeout: 9000, maxBuffer: 12 * 1024 * 1024 }, (error, stdout) => {
        if (error) {
            reject(error);
            return;
        }

        try {
            resolve(JSON.parse(stdout));
        } catch (parseError) {
            reject(parseError);
        }
    });
});

const firstLine = (value) => String(value || '').split('\n').find(Boolean) || '';

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

const normalizeText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const getPrimaryArtist = (artist) => firstLine(String(artist || '')
    .split(/,| feat\.? | ft\.? | featuring /i)
    .map((part) => part.trim())
    .find(Boolean) || artist);

const scoreSongMatch = (song, title, artist, album) => {
    const songTitle = normalizeText(song?.title || song?.name || '');
    const songArtist = normalizeText(song?.displayArtist || song?.artist || '');
    const songAlbum = normalizeText(song?.album || song?.name || '');
    const targetTitle = normalizeText(title);
    const targetArtist = normalizeText(artist);
    const targetAlbum = normalizeText(album);
    const targetPrimaryArtist = normalizeText(getPrimaryArtist(artist));
    let score = 0;

    if (songTitle && songTitle === targetTitle) score += 6;
    else if (songTitle.includes(targetTitle) || targetTitle.includes(songTitle)) score += 4;

    if (songArtist && (songArtist === targetArtist || songArtist === targetPrimaryArtist)) score += 4;
    else if (songArtist.includes(targetPrimaryArtist) || targetPrimaryArtist.includes(songArtist)) score += 3;

    if (targetAlbum && songAlbum && (songAlbum === targetAlbum || songAlbum.includes(targetAlbum) || targetAlbum.includes(songAlbum))) score += 2;

    if (song?.duration && Number.isFinite(Number(song.duration))) score += 0.1;

    return score;
};

const readMpris = async () => {
    const [positionRaw, durationRaw, status, title, artist, album, artUrl, player, volumeRaw] = await Promise.all([
        runPlayerctl(['position']),
        runPlayerctl(['metadata', 'mpris:length']),
        runPlayerctl(['status']),
        runPlayerctl(['metadata', 'xesam:title']),
        runPlayerctl(['metadata', 'xesam:artist']),
        runPlayerctl(['metadata', 'xesam:album']),
        runPlayerctl(['metadata', 'mpris:artUrl']),
        runPlayerctl(['metadata', 'mpris:trackid']),
        runPlayerctl(['volume']),
    ]);

    const position = Number.parseFloat(positionRaw);
    const durationMicros = Number.parseFloat(durationRaw);
    const volume = Number.parseFloat(volumeRaw);
    const cleanArtUrl = firstLine(artUrl);

    return {
        title: firstLine(title),
        artist: firstLine(artist),
        album: firstLine(album),
        artUrl: cleanArtUrl,
        coverUrl: cleanArtUrl ? '/mpris/art' : '',
        position: Number.isFinite(position) ? position : null,
        duration: Number.isFinite(durationMicros) ? durationMicros / 1000000 : null,
        volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : null,
        status: firstLine(status).toLowerCase() || 'unknown',
        trackId: firstLine(player) || [title, artist, album, durationRaw].join('|'),
    };
};

const sendJson = (response, statusCode, payload) => {
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(payload));
};

const fetchRemoteJson = (url) => runCurlJson(url);

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
    const coverArt = firstLine(item?.coverArt || '');
    const imageUrl = firstLine(item?.artistImageUrl || item?.imageUrl || '');

    return {
        id: firstLine(item?.id || `${mode}-${index}`),
        title,
        subtitle: mode === 'albums' ? artist : '',
        tracks: Number.isFinite(tracks) ? tracks : 0,
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

const getNavidromeLibraryItems = async (connection, mode) => {
    if (mode === 'artists') {
        const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getArtists').toString());
        const indexes = asList(payload?.['subsonic-response']?.artists?.index);
        return indexes
            .flatMap((index) => asList(index?.artist))
            .map((artist, index) => normalizeLibraryItem(artist, mode, index))
            .filter((artist) => artist.title)
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
    const mode = firstLine(searchParams.get('mode')) === 'albums' ? 'albums' : 'artists';

    if (!connection.url || !connection.username || !connection.password) {
        sendJson(response, 400, { error: 'missing navidrome connection' });
        return;
    }

    try {
        const items = await getNavidromeLibraryItems(connection, mode);
        sendJson(response, 200, { mode, items });
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

const getNavidromeCoverTarget = async (request) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const connection = getNavidromeConnection(searchParams);
    const id = firstLine(searchParams.get('id'));
    const coverArt = firstLine(searchParams.get('coverArt'));
    const imageUrl = firstLine(searchParams.get('imageUrl'));
    const type = firstLine(searchParams.get('type'));
    const requestedSize = Number.parseInt(searchParams.get('size'), 10);
    const coverSize = requestedSize === COVER_BACKGROUND_SIZE ? COVER_BACKGROUND_SIZE : COVER_ART_SIZE;

    if (!connection.url || !connection.username || !connection.password) {
        throw new Error('missing navidrome connection');
    }

    const cachePrefix = `${normalizeServerUrl(connection.url).origin}|${connection.username}|${type}`;

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        return { artUrl: imageUrl, cacheKey: `${cachePrefix}|image|${imageUrl}` };
    }

    if (coverArt) {
        return {
            artUrl: buildNavidromeUrl(connection, 'getCoverArt', {
                id: coverArt,
                size: coverSize,
            }).toString(),
            cacheKey: `${cachePrefix}|coverArt|${coverArt}|size:${coverSize}`,
        };
    }

    if (type === 'artist' && id) {
        const payload = await fetchRemoteJson(buildNavidromeUrl(connection, 'getArtistInfo2', {
            id,
            count: 0,
        }).toString());
        const info = payload?.['subsonic-response']?.artistInfo2 || {};
        const remoteImage = firstLine(info.largeImageUrl || info.mediumImageUrl || info.smallImageUrl || '');

        if (remoteImage) {
            return { artUrl: remoteImage, cacheKey: `${cachePrefix}|artist|${id}|${remoteImage}` };
        }
    }

    throw new Error('cover not found');
};

const sendNavidromeCover = async (request, response) => {
    try {
        const { artUrl, cacheKey } = await getNavidromeCoverTarget(request);
        await sendCachedRemoteArt(artUrl, response, cacheKey);
    } catch (error) {
        sendJson(response, error?.message === 'missing navidrome connection' ? 400 : 404, { error: error?.message || 'cover not found' });
    }
};

const sendNavidromeCacheCover = async (request, response) => {
    try {
        const { artUrl, cacheKey } = await getNavidromeCoverTarget(request);
        const { palette } = await cacheRemoteArt(artUrl, cacheKey);
        sendJson(response, 200, { ok: true, palette });
    } catch (error) {
        sendJson(response, error?.message === 'missing navidrome connection' ? 400 : 404, { error: error?.message || 'cover not found' });
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

        sendJson(response, 404, { error: 'lyrics not found' });
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

        sendJson(response, 404, { error: 'lyrics not found' });
    }
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

    const artistVariants = [...new Set([artist, getPrimaryArtist(artist)])];

    for (const artistName of artistVariants) {
        const params = buildLyricsParams({ title, artist: artistName, album, duration });

        try {
            sendJson(response, 200, await fetchRemoteJson(`https://lrclib.net/api/get-cached?${params}`));
            return;
        } catch {}
    }

    for (const artistName of artistVariants) {
        const params = buildLyricsParams({ title, artist: artistName, album, duration });

        try {
            sendJson(response, 200, await fetchRemoteJson(`https://lrclib.net/api/get?${params}`));
            return;
        } catch {}
    }

    for (const artistName of artistVariants) {
        const params = buildLyricsParams({ title, artist: artistName, album, duration }, false);

        try {
            const match = pickLyricsMatch(await fetchRemoteJson(`https://lrclib.net/api/search?${params}`), duration);

            if (match) {
                sendJson(response, 200, match);
                return;
            }
        } catch {}
    }

    try {
        const params = new URLSearchParams({ q: `${title} ${artist} ${album}`.trim() });
        const match = pickLyricsMatch(await fetchRemoteJson(`https://lrclib.net/api/search?${params}`), duration);

        if (match) {
            sendJson(response, 200, match);
            return;
        }
    } catch {}

    sendJson(response, 404, { error: 'lyrics not found' });
};

const sendRemoteArt = (artUrl, response) => {
    const client = artUrl.startsWith('https:') ? https : http;

    client.get(artUrl, (remoteResponse) => {
        if (remoteResponse.statusCode >= 300 && remoteResponse.statusCode < 400 && remoteResponse.headers.location) {
            sendRemoteArt(new URL(remoteResponse.headers.location, artUrl).toString(), response);
            return;
        }

        response.writeHead(remoteResponse.statusCode || 200, {
            'content-type': remoteResponse.headers['content-type'] || 'image/jpeg',
        });
        remoteResponse.pipe(response);
    }).on('error', () => {
        sendJson(response, 404, { error: 'art not found' });
    });
};

const fetchRemoteBinary = (remoteUrl, redirects = 4) => new Promise((resolve, reject) => {
    const client = remoteUrl.startsWith('https:') ? https : http;

    client.get(remoteUrl, (remoteResponse) => {
        if (remoteResponse.statusCode >= 300 && remoteResponse.statusCode < 400 && remoteResponse.headers.location && redirects > 0) {
            resolve(fetchRemoteBinary(new URL(remoteResponse.headers.location, remoteUrl).toString(), redirects - 1));
            return;
        }

        if ((remoteResponse.statusCode || 500) >= 400) {
            reject(new Error('remote art not found'));
            remoteResponse.resume();
            return;
        }

        const chunks = [];
        let total = 0;

        remoteResponse.on('data', (chunk) => {
            total += chunk.length;
            if (total > 12 * 1024 * 1024) {
                remoteResponse.destroy(new Error('remote art too large'));
                return;
            }
            chunks.push(chunk);
        });
        remoteResponse.on('end', () => {
            resolve({
                buffer: Buffer.concat(chunks),
                contentType: remoteResponse.headers['content-type'] || 'image/jpeg',
            });
        });
    }).on('error', reject);
});

const getCoverCachePaths = (artUrl, cacheKey) => {
    const hash = createHash('sha256').update(cacheKey || artUrl).digest('hex');
    return {
        imagePath: join(COVER_CACHE_DIR, `${hash}.bin`),
        metaPath: join(COVER_CACHE_DIR, `${hash}.json`),
    };
};

const clampColor = (value) => Math.max(0, Math.min(255, Math.round(value)));
const rgbToHex = ([red, green, blue]) => `#${[red, green, blue].map((channel) => clampColor(channel).toString(16).padStart(2, '0')).join('')}`;
const colorToRgba = ([red, green, blue], alpha) => `rgba(${clampColor(red)}, ${clampColor(green)}, ${clampColor(blue)}, ${alpha})`;
const mixColor = (color, target, amount) => color.map((channel, index) => channel + ((target[index] - channel) * amount));
const getLuminance = ([red, green, blue]) => {
    const [r, g, b] = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });

    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};

const buildPaletteFromAverage = (average) => {
    const isDark = getLuminance(average) < 0.42;
    const primary = isDark ? mixColor(average, [216, 243, 220], 0.32) : mixColor(average, [0, 62, 24], 0.18);
    const secondary = isDark ? mixColor(average, [82, 183, 136], 0.48) : mixColor(average, [216, 243, 220], 0.46);
    const text = isDark ? mixColor(average, [245, 255, 245], 0.9) : mixColor(average, [0, 35, 10], 0.86);
    const shadow = isDark ? mixColor(average, [0, 0, 0], 0.74) : mixColor(average, [0, 20, 8], 0.78);
    const surface = isDark ? mixColor(average, [0, 0, 0], 0.2) : mixColor(average, [255, 255, 255], 0.58);
    const glow = isDark ? mixColor(average, [116, 198, 157], 0.42) : mixColor(average, [45, 106, 79], 0.36);
    const sheen = isDark ? mixColor(average, [255, 255, 255], 0.64) : mixColor(average, [216, 243, 220], 0.7);

    return {
        primary: rgbToHex(primary),
        secondary: rgbToHex(secondary),
        text: rgbToHex(text),
        shadow: rgbToHex(shadow),
        surface: rgbToHex(surface),
        glow: colorToRgba(glow, isDark ? 0.42 : 0.34),
        sheen: colorToRgba(sheen, isDark ? 0.3 : 0.42),
        overlay: isDark ? 'linear-gradient(rgba(255, 255, 255, 0.08), rgba(216, 243, 220, 0.2))' : 'linear-gradient(rgba(0, 35, 10, 0.08), rgba(0, 20, 8, 0.18))',
        isDark,
    };
};

const extractPpmAverage = (buffer) => {
    let cursor = 0;
    const readToken = () => {
        while (cursor < buffer.length) {
            const char = String.fromCharCode(buffer[cursor]);
            if (/\s/.test(char)) {
                cursor += 1;
                continue;
            }
            if (char === '#') {
                while (cursor < buffer.length && String.fromCharCode(buffer[cursor]) !== '\n') cursor += 1;
                continue;
            }
            break;
        }

        const start = cursor;
        while (cursor < buffer.length && !/\s/.test(String.fromCharCode(buffer[cursor]))) cursor += 1;
        return buffer.toString('ascii', start, cursor);
    };

    if (readToken() !== 'P6') {
        throw new Error('unsupported ppm');
    }

    const width = Number(readToken());
    const height = Number(readToken());
    const max = Number(readToken());
    while (cursor < buffer.length && /\s/.test(String.fromCharCode(buffer[cursor]))) cursor += 1;

    if (!width || !height || max <= 0) {
        throw new Error('invalid ppm');
    }

    const pixelCount = width * height;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    const stride = Math.max(1, Math.floor(pixelCount / 4096));

    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
        const index = cursor + (pixel * 3);
        if (index + 2 >= buffer.length) break;
        red += buffer[index];
        green += buffer[index + 1];
        blue += buffer[index + 2];
        count += 1;
    }

    return count ? [red / count, green / count, blue / count] : [116, 198, 157];
};

const extractCoverPalette = async (imagePath) => {
    if (!HAS_FILE_COMMAND) {
        return buildPaletteFromAverage([116, 198, 157]);
    }

    try {
        const ppm = await new Promise((resolve, reject) => {
            execFile('file', ['--brief', '--mime-type', imagePath], { timeout: 1200 }, (mimeError, mimeStdout) => {
                if (mimeError || !String(mimeStdout).startsWith('image/')) {
                    reject(mimeError || new Error('not image'));
                    return;
                }

                // Use ImageMagick when available, otherwise fall back to the spinach green palette.
                execFile('magick', [imagePath, '-resize', '64x64!', 'ppm:-'], { timeout: 3500, maxBuffer: 1024 * 1024, encoding: 'buffer' }, (magickError, stdout) => {
                    if (!magickError && stdout?.length) {
                        resolve(stdout);
                        return;
                    }

                    execFile('convert', [imagePath, '-resize', '64x64!', 'ppm:-'], { timeout: 3500, maxBuffer: 1024 * 1024, encoding: 'buffer' }, (convertError, convertStdout) => {
                        if (convertError || !convertStdout?.length) {
                            reject(convertError || magickError || new Error('palette unavailable'));
                            return;
                        }

                        resolve(convertStdout);
                    });
                });
            });
        });

        return buildPaletteFromAverage(extractPpmAverage(ppm));
    } catch {
        return buildPaletteFromAverage([116, 198, 157]);
    }
};

const cacheRemoteArt = async (artUrl, cacheKey) => {
    const { imagePath, metaPath } = getCoverCachePaths(artUrl, cacheKey);

    try {
        const meta = JSON.parse(await readFile(metaPath, 'utf8'));
        if (!meta.palette) {
            meta.palette = await extractCoverPalette(imagePath);
            await writeFile(metaPath, JSON.stringify(meta));
        }
        return { imagePath, contentType: meta.contentType || 'image/jpeg', cached: true, palette: meta.palette };
    } catch {}

    const { buffer, contentType } = await fetchRemoteBinary(artUrl);
    if (!String(contentType).startsWith('image/')) {
        throw new Error('remote art is not an image');
    }

    await mkdir(COVER_CACHE_DIR, { recursive: true });
    await writeFile(imagePath, buffer);
    const palette = await extractCoverPalette(imagePath);
    await writeFile(metaPath, JSON.stringify({ contentType, cachedAt: new Date().toISOString(), palette }));

    return { imagePath, contentType, cached: false, buffer, palette };
};

const sendCachedRemoteArt = async (artUrl, response, cacheKey) => {
    try {
        const { imagePath, contentType, buffer } = await cacheRemoteArt(artUrl, cacheKey);

        response.writeHead(200, {
            'content-type': contentType,
            'cache-control': 'public, max-age=31536000, immutable',
        });

        if (buffer) {
            response.end(buffer);
            return;
        }

        createReadStream(imagePath).pipe(response);
    } catch {
        sendJson(response, 404, { error: 'art not found' });
    }
};

const sendMprisArt = async (response) => {
    const { artUrl } = await readMpris();

    if (!artUrl) {
        sendJson(response, 404, { error: 'no art' });
        return;
    }

    if (artUrl.startsWith('file://')) {
        try {
            const artPath = fileURLToPath(artUrl);
            response.writeHead(200, {
                'content-type': mimeTypes[extname(artPath)] || 'image/jpeg',
            });
            createReadStream(artPath).pipe(response);
        } catch {
            sendJson(response, 404, { error: 'art not found' });
        }
        return;
    }

    if (artUrl.startsWith('http://') || artUrl.startsWith('https://')) {
        sendRemoteArt(artUrl, response);
        return;
    }

    sendJson(response, 404, { error: 'unsupported art url' });
};

const sendMprisControl = async (request, response) => {
    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const action = searchParams.get('action');

    if (action === 'seek') {
        const position = Number.parseFloat(searchParams.get('position'));

        if (!Number.isFinite(position) || position < 0) {
            sendJson(response, 400, { error: 'bad seek position' });
            return;
        }

        await runPlayerctl(['position', String(position)]);
        sendJson(response, 200, { ok: true });
        return;
    }

    if (action === 'volume') {
        const volume = Number.parseFloat(searchParams.get('volume'));

        if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
            sendJson(response, 400, { error: 'bad volume' });
            return;
        }

        await runPlayerctl(['volume', String(volume)]);
        sendJson(response, 200, { ok: true, volume });
        return;
    }

    const command = {
        previous: 'previous',
        back: 'previous',
        toggle: 'play-pause',
        play: 'play',
        pause: 'pause',
        next: 'next',
    }[action];

    if (!command) {
        sendJson(response, 400, { error: 'bad control action' });
        return;
    }

    await runPlayerctl([command]);
    sendJson(response, 200, { ok: true });
};

const sendFile = async (request, response) => {
    const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
    const safePath = normalize(decodeURIComponent(requestPath)).replace(/^\.\.(\/|\\|$)/, '');
    const filePath = join(ROOT, safePath === '/' ? 'index.html' : safePath);

    if (!filePath.startsWith(ROOT)) {
        sendJson(response, 403, { error: 'forbidden' });
        return;
    }

    try {
        const file = await readFile(filePath);
        response.writeHead(200, {
            'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
        });
        response.end(file);
    } catch {
        sendJson(response, 404, { error: 'not found' });
    }
};

const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/mpris') {
        sendJson(response, 200, await readMpris());
        return;
    }

    if (pathname === '/mpris/art') {
        await sendMprisArt(response);
        return;
    }

    if (pathname === '/mpris/control') {
        await sendMprisControl(request, response);
        return;
    }

    if (pathname === '/navidrome/lyrics') {
        await sendNavidromeLyrics(request, response);
        return;
    }

    if (pathname === '/navidrome/library') {
        await sendNavidromeLibrary(request, response);
        return;
    }

    if (pathname === '/navidrome/tracks') {
        await sendNavidromeTracks(request, response);
        return;
    }

    if (pathname === '/navidrome/stream') {
        await sendNavidromeStream(request, response);
        return;
    }

    if (pathname === '/navidrome/cover') {
        await sendNavidromeCover(request, response);
        return;
    }

    if (pathname === '/navidrome/cache-cover') {
        await sendNavidromeCacheCover(request, response);
        return;
    }

    if (pathname === '/lyrics') {
        await sendLyrics(request, response);
        return;
    }

    if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'method not allowed' });
        return;
    }

    await sendFile(request, response);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`spinach music running at http://127.0.0.1:${PORT}`);
});
