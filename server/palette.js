const { execFile, execFileSync } = require('child_process');

const COVER_PALETTE_VERSION = 4;
const HAS_FILE_COMMAND = (() => {
    try {
        execFileSync('file', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

const clampColor = (value) => Math.max(0, Math.min(255, Math.round(value)));
const rgbToHex = ([red, green, blue]) => `#${[red, green, blue].map((channel) => clampColor(channel).toString(16).padStart(2, '0')).join('')}`;
const colorToRgba = ([red, green, blue], alpha) => `rgba(${clampColor(red)}, ${clampColor(green)}, ${clampColor(blue)}, ${alpha})`;
const mixColor = (color, target, amount) => color.map((channel, index) => channel + ((target[index] - channel) * amount));
const rgbToHsl = ([red, green, blue]) => {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;

    if (!delta) {
        return { hue: 0, saturation: 0, lightness };
    }

    const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
    let hue;

    if (max === r) {
        hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
        hue = 60 * (((b - r) / delta) + 2);
    } else {
        hue = 60 * (((r - g) / delta) + 4);
    }

    return {
        hue: hue < 0 ? hue + 360 : hue,
        saturation,
        lightness,
    };
};
const getLuminance = ([red, green, blue]) => {
    const [r, g, b] = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });

    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};

const getHuePreference = (hue) => {
    if (hue >= 345 || hue <= 24) return 1.86;
    if (hue > 24 && hue <= 58) return 1.58;
    if (hue > 58 && hue <= 82) return 1.2;
    if (hue >= 170 && hue <= 245) return 0.56;
    if (hue > 245 && hue < 300) return 0.82;
    return 1;
};

const getPaletteFingerprint = (pixels = []) => {
    if (!pixels.length) {
        return 'fallback';
    }

    const hueBins = Array.from({ length: 12 }, () => 0);
    let chromaTotal = 0;
    let saturationTotal = 0;
    let lightnessTotal = 0;
    let averageRed = 0;
    let averageGreen = 0;
    let averageBlue = 0;

    pixels.forEach(({ color, hsl }) => {
        const { hue, saturation, lightness } = hsl;
        const chroma = Math.max(0.08, saturation) * (1 - (Math.abs(lightness - 0.5) * 0.9));
        const hueIndex = Math.min(hueBins.length - 1, Math.floor(hue / 30));
        hueBins[hueIndex] += chroma;
        chromaTotal += chroma;
        saturationTotal += saturation;
        lightnessTotal += lightness;
        averageRed += color[0];
        averageGreen += color[1];
        averageBlue += color[2];
    });

    const quantizedHue = hueBins.map((score) => Math.min(9, Math.round(((score / Math.max(chromaTotal, 0.001)) * 18)))).join('');
    const count = pixels.length;
    const saturation = Math.min(9, Math.round((saturationTotal / count) * 9));
    const lightness = Math.min(9, Math.round((lightnessTotal / count) * 9));
    const averageColor = [averageRed / count, averageGreen / count, averageBlue / count]
        .map((channel) => Math.min(15, Math.round(channel / 17)).toString(16))
        .join('');

    return `p4-${quantizedHue}-${saturation}${lightness}-${averageColor}`;
};

const buildPaletteFromStats = ({ average, accent, paletteKey = 'fallback' }) => {
    const base = accent || average || [116, 198, 157];
    const isDark = getLuminance(base) < 0.42;
    const primary = isDark ? mixColor(base, [216, 243, 220], 0.24) : mixColor(base, [255, 255, 255], 0.12);
    const secondary = isDark ? mixColor(base, [82, 183, 136], 0.34) : mixColor(base, [255, 255, 255], 0.42);
    const text = isDark ? mixColor(base, [245, 255, 245], 0.9) : mixColor(base, [0, 35, 10], 0.86);
    const shadow = isDark ? mixColor(base, [0, 0, 0], 0.74) : mixColor(base, [0, 20, 8], 0.78);
    const surface = isDark ? mixColor(base, [0, 0, 0], 0.2) : mixColor(base, [255, 255, 255], 0.58);
    const glow = isDark ? mixColor(base, [116, 198, 157], 0.36) : mixColor(base, [45, 106, 79], 0.26);
    const sheen = isDark ? mixColor(base, [255, 255, 255], 0.64) : mixColor(base, [255, 255, 255], 0.68);

    return {
        version: COVER_PALETTE_VERSION,
        primary: rgbToHex(primary),
        secondary: rgbToHex(secondary),
        text: rgbToHex(text),
        shadow: rgbToHex(shadow),
        surface: rgbToHex(surface),
        glow: colorToRgba(glow, isDark ? 0.42 : 0.34),
        sheen: colorToRgba(sheen, isDark ? 0.3 : 0.42),
        overlay: isDark ? 'linear-gradient(rgba(255, 255, 255, 0.08), rgba(216, 243, 220, 0.2))' : 'linear-gradient(rgba(0, 35, 10, 0.08), rgba(0, 20, 8, 0.18))',
        average: rgbToHex(average || base),
        accent: rgbToHex(base),
        paletteKey,
        isDark,
    };
};

const buildPaletteFromAverage = (average) => buildPaletteFromStats({ average, accent: average, paletteKey: 'fallback' });

const extractPpmStats = (buffer) => {
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
    const hueBins = Array.from({ length: 36 }, () => ({ red: 0, green: 0, blue: 0, score: 0, count: 0 }));
    const pixels = [];
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    const stride = Math.max(1, Math.floor(pixelCount / 8192));

    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
        const index = cursor + (pixel * 3);
        if (index + 2 >= buffer.length) break;

        const color = [buffer[index], buffer[index + 1], buffer[index + 2]];
        const hsl = rgbToHsl(color);
        red += color[0];
        green += color[1];
        blue += color[2];
        count += 1;
        pixels.push({ color, hsl });

        const { hue, saturation, lightness } = hsl;
        if (saturation < 0.16 || lightness < 0.08 || lightness > 0.96) {
            continue;
        }

        const bin = hueBins[Math.min(hueBins.length - 1, Math.floor(hue / 10))];
        const lightnessWeight = 1 - (Math.abs(lightness - 0.5) * 0.86);
        const vividness = (saturation ** 1.72) * Math.max(0.18, lightnessWeight);
        const warmthLift = getHuePreference(hue);
        const score = vividness * warmthLift;
        bin.red += color[0] * score;
        bin.green += color[1] * score;
        bin.blue += color[2] * score;
        bin.score += score;
        bin.count += 1;
    }

    const average = count ? [red / count, green / count, blue / count] : [116, 198, 157];
    const paletteKey = getPaletteFingerprint(pixels);
    let bestIndex = -1;
    let bestScore = 0;

    hueBins.forEach((bin, index) => {
        const previous = hueBins[(index - 1 + hueBins.length) % hueBins.length];
        const next = hueBins[(index + 1) % hueBins.length];
        const clusterScore = bin.score + (previous.score * 0.58) + (next.score * 0.58);
        const clusterCount = bin.count + (previous.count * 0.58) + (next.count * 0.58);
        const hue = index * 10;
        const score = clusterScore * (Math.max(1, clusterCount) ** 0.1) * getHuePreference(hue);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });

    if (bestIndex < 0 || bestScore < 0.5) {
        return { average, accent: average, paletteKey };
    }

    const selectedBins = [
        hueBins[(bestIndex - 1 + hueBins.length) % hueBins.length],
        hueBins[bestIndex],
        hueBins[(bestIndex + 1) % hueBins.length],
    ];
    const accentTotals = selectedBins.reduce((totals, bin) => ({
        red: totals.red + bin.red,
        green: totals.green + bin.green,
        blue: totals.blue + bin.blue,
        score: totals.score + bin.score,
        count: totals.count + bin.count,
    }), { red: 0, green: 0, blue: 0, score: 0, count: 0 });

    const accent = accentTotals.score
        ? [accentTotals.red / accentTotals.score, accentTotals.green / accentTotals.score, accentTotals.blue / accentTotals.score]
        : average;

    return { average, accent, paletteKey };
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

        return buildPaletteFromStats(extractPpmStats(ppm));
    } catch {
        return buildPaletteFromAverage([116, 198, 157]);
    }
};

module.exports = {
    COVER_PALETTE_VERSION,
    buildPaletteFromAverage,
    extractCoverPalette,
};
