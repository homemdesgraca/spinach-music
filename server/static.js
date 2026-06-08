const { readFile } = require('fs/promises');
const { extname, join, normalize } = require('path');
const { ROOT, mimeTypes, sendJson } = require('./utils');

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

module.exports = {
    sendFile,
};
