const http = require('http');
const https = require('https');
const { createReadStream } = require('fs');
const { createHash } = require('crypto');
const { mkdir, readFile, readdir, rm, writeFile } = require('fs/promises');
const { join } = require('path');
const { ROOT, sendJson } = require('./utils');
const { COVER_PALETTE_VERSION, extractCoverPalette } = require('./palette');

const COVER_CACHE_DIR = join(ROOT, '.cache', 'covers');
const COVER_ART_SIZE = 768;
const COVER_BACKGROUND_SIZE = 1000;
const COVER_BACKGROUND_HIGH_SIZE = 1600;
const COVER_BACKGROUND_MAX_SIZE = 3000;
const COVER_REMOTE_ART_MAX_BYTES = 64 * 1024 * 1024;

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

        const contentLength = Number(remoteResponse.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > COVER_REMOTE_ART_MAX_BYTES) {
            reject(new Error('remote art too large'));
            remoteResponse.resume();
            return;
        }

        const chunks = [];
        let total = 0;

        remoteResponse.on('data', (chunk) => {
            total += chunk.length;
            if (total > COVER_REMOTE_ART_MAX_BYTES) {
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

const cacheRemoteArt = async (artUrl, cacheKey) => {
    const { imagePath, metaPath } = getCoverCachePaths(artUrl, cacheKey);

    try {
        const meta = JSON.parse(await readFile(metaPath, 'utf8'));
        if (!meta.palette || meta.paletteVersion !== COVER_PALETTE_VERSION || meta.palette.version !== COVER_PALETTE_VERSION) {
            meta.palette = await extractCoverPalette(imagePath);
            meta.paletteVersion = COVER_PALETTE_VERSION;
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
    await writeFile(metaPath, JSON.stringify({ contentType, cachedAt: new Date().toISOString(), paletteVersion: COVER_PALETTE_VERSION, palette }));

    return { imagePath, contentType, cached: false, buffer, palette };
};

const getFirstCachedRemoteArt = async (targets) => {
    let lastError;

    for (const target of targets) {
        try {
            const cached = await cacheRemoteArt(target.artUrl, target.cacheKey);
            return { ...cached, target };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('art not found');
};

const sendClearCoverCache = async (request, response) => {
    if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
    }

    try {
        const files = await readdir(COVER_CACHE_DIR).catch(() => []);
        await rm(COVER_CACHE_DIR, { recursive: true, force: true });
        await mkdir(COVER_CACHE_DIR, { recursive: true });
        sendJson(response, 200, { ok: true, files: files.length });
    } catch (error) {
        sendJson(response, 500, { ok: false, error: error?.message || 'failed to clear cover cache' });
    }
};

const sendClearPaletteCache = async (request, response) => {
    if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
    }

    try {
        const files = await readdir(COVER_CACHE_DIR).catch(() => []);
        let cleared = 0;

        await Promise.all(files
            .filter((file) => file.endsWith('.json'))
            .map(async (file) => {
                const metaPath = join(COVER_CACHE_DIR, file);
                try {
                    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
                    if (!meta.palette && !meta.paletteVersion) {
                        return;
                    }

                    delete meta.palette;
                    delete meta.paletteVersion;
                    meta.paletteClearedAt = new Date().toISOString();
                    await writeFile(metaPath, JSON.stringify(meta));
                    cleared += 1;
                } catch {}
            }));

        sendJson(response, 200, { ok: true, files: cleared });
    } catch (error) {
        sendJson(response, 500, { ok: false, error: error?.message || 'failed to clear palette cache' });
    }
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

module.exports = {
    COVER_ART_SIZE,
    COVER_BACKGROUND_SIZE,
    COVER_BACKGROUND_HIGH_SIZE,
    COVER_BACKGROUND_MAX_SIZE,
    cacheRemoteArt,
    getFirstCachedRemoteArt,
    sendClearCoverCache,
    sendClearPaletteCache,
    sendCachedRemoteArt,
};
