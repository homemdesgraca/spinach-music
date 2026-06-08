const http = require('http');
const { PORT, sendJson } = require('./utils');
const { readMpris, sendMprisArt, sendMprisControl } = require('./mpris');
const {
    sendNavidromeCacheCover,
    sendNavidromeCover,
    sendNavidromeLibrary,
    sendNavidromeLyrics,
    sendNavidromeStream,
    sendNavidromeTracks,
} = require('./navidrome');
const { sendLyrics } = require('./lyrics');
const { sendClearCoverCache, sendClearPaletteCache } = require('./covers');
const { sendFile } = require('./static');

const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
    }

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

    if (pathname === '/cache/covers/clear') {
        await sendClearCoverCache(request, response);
        return;
    }

    if (pathname === '/cache/palettes/clear') {
        await sendClearPaletteCache(request, response);
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

module.exports = server;
