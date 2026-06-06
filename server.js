const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { readFile } = require('fs/promises');
const { createReadStream } = require('fs');
const { extname, join, normalize } = require('path');
const { fileURLToPath } = require('url');

const PORT = 5500;
const ROOT = __dirname;

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
    execFile('curl', ['-fsSL', '--max-time', '8', url], { timeout: 9000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
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
    const [positionRaw, durationRaw, status, title, artist, album, artUrl, player] = await Promise.all([
        runPlayerctl(['position']),
        runPlayerctl(['metadata', 'mpris:length']),
        runPlayerctl(['status']),
        runPlayerctl(['metadata', 'xesam:title']),
        runPlayerctl(['metadata', 'xesam:artist']),
        runPlayerctl(['metadata', 'xesam:album']),
        runPlayerctl(['metadata', 'mpris:artUrl']),
        runPlayerctl(['metadata', 'mpris:trackid']),
    ]);

    const position = Number.parseFloat(positionRaw);
    const durationMicros = Number.parseFloat(durationRaw);
    const cleanArtUrl = firstLine(artUrl);

    return {
        title: firstLine(title),
        artist: firstLine(artist),
        album: firstLine(album),
        artUrl: cleanArtUrl,
        coverUrl: cleanArtUrl ? '/mpris/art' : '',
        position: Number.isFinite(position) ? position : null,
        duration: Number.isFinite(durationMicros) ? durationMicros / 1000000 : null,
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

const buildNavidromeUrl = (connection, endpoint, params = {}) => {
    const url = new URL(`rest/${endpoint}.view`, normalizeServerUrl(connection.url));

    url.searchParams.set('u', connection.username);
    url.searchParams.set('p', connection.password);
    url.searchParams.set('v', '1.16.1');
    url.searchParams.set('c', 'spinach-music');
    url.searchParams.set('f', 'json');

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

const structuredEntryToLyrics = (entry) => {
    if (!entry) {
        return null;
    }

    const lineEntries = Array.isArray(entry.cueLine) && entry.cueLine.length
        ? entry.cueLine
        : Array.isArray(entry.line) ? entry.line : [];

    const syncedLyrics = lineEntriesToLrc(lineEntries);
    const plainLyrics = (Array.isArray(entry.line) && entry.line.length
        ? entry.line
        : lineEntries)
        .map((line) => String(line.value || '').trim())
        .filter(Boolean)
        .join('\n');

    return {
        source: 'navidrome-structured',
        kind: entry.kind || 'main',
        plainLyrics,
        syncedLyrics,
        displayArtist: entry.displayArtist || '',
        displayTitle: entry.displayTitle || '',
    };
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

        if (normalized?.syncedLyrics) {
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
        const text = firstLine(plain?.['subsonic-response']?.lyrics?.value || plain?.['subsonic-response']?.lyrics?.text || '');

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
            const text = firstLine(plain?.['subsonic-response']?.lyrics?.value || plain?.['subsonic-response']?.lyrics?.text || '');

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
            sendRemoteArt(remoteResponse.headers.location, response);
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
