const http = require('http');
const https = require('https');
const { createReadStream } = require('fs');
const { extname } = require('path');
const { fileURLToPath } = require('url');
const { firstLine, mimeTypes, runPlayerctl, sendJson } = require('./utils');

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

module.exports = {
    readMpris,
    sendMprisArt,
    sendMprisControl,
};
