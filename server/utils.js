const { execFile } = require('child_process');
const { extname, join } = require('path');

const PORT = 5500;
const ROOT = join(__dirname, '..');

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

const sendJson = (response, statusCode, payload) => {
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(payload));
};

const fetchRemoteJson = (url) => runCurlJson(url);

const firstFulfilled = (promises) => new Promise((resolve, reject) => {
    if (!promises.length) {
        reject(new Error('no requests'));
        return;
    }

    let pending = promises.length;
    const errors = [];

    promises.forEach((promise, index) => {
        Promise.resolve(promise).then(resolve).catch((error) => {
            errors[index] = error;
            pending -= 1;

            if (!pending) {
                reject(errors.find(Boolean) || new Error('all requests failed'));
            }
        });
    });
});

const normalizePlainLyricsText = (value) => String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

const asList = (value) => Array.isArray(value) ? value : value ? [value] : [];

module.exports = {
    PORT,
    ROOT,
    mimeTypes,
    runPlayerctl,
    runCurlJson,
    fetchRemoteJson,
    firstLine,
    normalizeServerUrl,
    normalizeText,
    getPrimaryArtist,
    scoreSongMatch,
    sendJson,
    firstFulfilled,
    normalizePlainLyricsText,
    asList,
};
