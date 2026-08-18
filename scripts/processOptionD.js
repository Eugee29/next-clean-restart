const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const inputJpgPath = 'C:\\Users\\urig\\.gemini\\antigravity\\brain\\3cbd58b7-ae46-43b8-9c9b-1cfc1de8e6ff\\large_icon_d_1787052721218.jpg';
const outputPngPath = path.join(__dirname, '..', 'icon.png');

console.log('Reading Option D from:', inputJpgPath);
const jpegData = fs.readFileSync(inputJpgPath);
const raw = jpeg.decode(jpegData, { useTArray: true });

const srcW = raw.width;
const srcH = raw.height;
const srcData = raw.data;

// Step 1: Find tight bounding box of the emblem
const bgThreshold = 35;
let minX = srcW;
let maxX = 0;
let minY = srcH;
let maxY = 0;

for (let y = 0; y < srcH; y++) {
  for (let x = 0; x < srcW; x++) {
    const idx = (y * srcW + x) * 4;
    const r = srcData[idx];
    const g = srcData[idx + 1];
    const b = srcData[idx + 2];
    const maxVal = Math.max(r, g, b);

    if (maxVal > bgThreshold) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

console.log(`Emblem bounding box: [${minX}, ${minY}] to [${maxX}, ${maxY}] (width: ${maxX - minX + 1}, height: ${maxY - minY + 1})`);

// Step 2: Target square dimensions (512x512) filling the canvas completely with minimal padding (e.g. 8px)
const targetSize = 512;
const padding = 8;
const targetEmblemSize = targetSize - padding * 2;

const emblemW = maxX - minX + 1;
const emblemH = maxY - minY + 1;
const scale = targetEmblemSize / Math.max(emblemW, emblemH);

const scaledW = Math.round(emblemW * scale);
const scaledH = Math.round(emblemH * scale);
const offsetX = padding + Math.round((targetEmblemSize - scaledW) / 2);
const offsetY = padding + Math.round((targetEmblemSize - scaledH) / 2);

const outputPng = new PNG({ width: targetSize, height: targetSize });

// Fill transparent
for (let i = 0; i < targetSize * targetSize * 4; i += 4) {
  outputPng.data[i] = 0;
  outputPng.data[i + 1] = 0;
  outputPng.data[i + 2] = 0;
  outputPng.data[i + 3] = 0;
}

// Step 3: Resample cropped region to target canvas with bilinear interpolation and alpha transparency
for (let ty = 0; ty < scaledH; ty++) {
  for (let tx = 0; tx < scaledW; tx++) {
    const targetX = offsetX + tx;
    const targetY = offsetY + ty;

    if (targetX < 0 || targetX >= targetSize || targetY < 0 || targetY >= targetSize) continue;

    // Source coordinates in cropped bounding box
    const srcX = minX + (tx / scaledW) * emblemW;
    const srcY = minY + (ty / scaledH) * emblemH;

    // Bilinear interpolation
    const x0 = Math.floor(srcX);
    const x1 = Math.min(x0 + 1, srcW - 1);
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);

    const fx = srcX - x0;
    const fy = srcY - y0;

    const idx00 = (y0 * srcW + x0) * 4;
    const idx10 = (y0 * srcW + x1) * 4;
    const idx01 = (y1 * srcW + x0) * 4;
    const idx11 = (y1 * srcW + x1) * 4;

    const r = (1 - fx) * (1 - fy) * srcData[idx00] + fx * (1 - fy) * srcData[idx10] + (1 - fx) * fy * srcData[idx01] + fx * fy * srcData[idx11];
    const g = (1 - fx) * (1 - fy) * srcData[idx00 + 1] + fx * (1 - fy) * srcData[idx10 + 1] + (1 - fx) * fy * srcData[idx01 + 1] + fx * fy * srcData[idx11 + 1];
    const b = (1 - fx) * (1 - fy) * srcData[idx00 + 2] + fx * (1 - fy) * srcData[idx10 + 2] + (1 - fx) * fy * srcData[idx01 + 2] + fx * fy * srcData[idx11 + 2];

    const maxVal = Math.max(r, g, b);
    const lowThresh = 20;
    const highThresh = 70;

    let alpha = 0;
    if (maxVal <= lowThresh) {
      alpha = 0;
    } else if (maxVal >= highThresh) {
      alpha = 255;
    } else {
      alpha = Math.round(((maxVal - lowThresh) / (highThresh - lowThresh)) * 255);
    }

    const outIdx = (targetY * targetSize + targetX) * 4;
    outputPng.data[outIdx] = Math.round(r);
    outputPng.data[outIdx + 1] = Math.round(g);
    outputPng.data[outIdx + 2] = Math.round(b);
    outputPng.data[outIdx + 3] = alpha;
  }
}

const buffer = PNG.sync.write(outputPng);
fs.writeFileSync(outputPngPath, buffer);
console.log('Successfully written full-canvas transparent icon to:', outputPngPath);
