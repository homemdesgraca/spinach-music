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

const firstLine = (value) => String(value || '').split('\n').find(Boolean) || '';

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
    const action = new URL(request.url, `http://${request.headers.host}`).searchParams.get('action');
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

    if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'method not allowed' });
        return;
    }

    await sendFile(request, response);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`spinach music running at http://127.0.0.1:${PORT}`);
});
