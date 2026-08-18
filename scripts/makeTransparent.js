const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const inputJpgPath = 'C:\\Users\\urig\\.gemini\\antigravity\\brain\\3cbd58b7-ae46-43b8-9c9b-1cfc1de8e6ff\\minimal_icon_three_1787037737797.jpg';
const outputPngPath = path.join(__dirname, '..', 'icon.png');

console.log('Reading input image from:', inputJpgPath);
const jpegData = fs.readFileSync(inputJpgPath);
const rawData = jpeg.decode(jpegData, { useTArray: true });

const { width, height, data } = rawData;
const png = new PNG({ width, height });

// Sample corner background color
const bgR = data[0];
const bgG = data[1];
const bgB = data[2];

const bgMax = Math.max(bgR, bgG, bgB, 30);
const lowThreshold = bgMax + 10; // Below this is fully transparent
const highThreshold = bgMax + 60; // Above this is fully opaque

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (width * y + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Compute maximum color intensity
    const maxVal = Math.max(r, g, b);

    let alpha = 0;
    if (maxVal <= lowThreshold) {
      alpha = 0;
    } else if (maxVal >= highThreshold) {
      alpha = 255;
    } else {
      alpha = Math.round(((maxVal - lowThreshold) / (highThreshold - lowThreshold)) * 255);
    }

    // Set PNG RGBA values
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = alpha;
  }
}

const buffer = PNG.sync.write(png);
fs.writeFileSync(outputPngPath, buffer);
console.log('Successfully saved transparent PNG icon to:', outputPngPath);
