const fs = require('fs');
const { PNG } = require('pngjs');

function readPng(path) {
  return PNG.sync.read(fs.readFileSync(path));
}

function resizeBilinear(src, targetWidth, targetHeight) {
  const out = new PNG({ width: targetWidth, height: targetHeight });
  const xScale = src.width / targetWidth;
  const yScale = src.height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const outIndex = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + channel];
        const p10 = src.data[(y0 * src.width + x1) * 4 + channel];
        const p01 = src.data[(y1 * src.width + x0) * 4 + channel];
        const p11 = src.data[(y1 * src.width + x1) * 4 + channel];
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out.data[outIndex + channel] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return out;
}

function roundedMask(image, radius) {
  const cx = image.width / 2;
  const cy = image.height / 2;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = Math.max(Math.abs(x - cx) - (cx - radius), 0);
      const dy = Math.max(Math.abs(y - cy) - (cy - radius), 0);
      if (dx * dx + dy * dy > radius * radius) {
        image.data[(y * image.width + x) * 4 + 3] = 0;
      }
    }
  }
  return image;
}

function alphaOver(base, overlay, left, top) {
  for (let y = 0; y < overlay.height; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= base.height) continue;
    for (let x = 0; x < overlay.width; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= base.width) continue;
      const sourceIndex = (y * overlay.width + x) * 4;
      const targetIndex = (targetY * base.width + targetX) * 4;
      const sourceAlpha = overlay.data[sourceIndex + 3] / 255;
      if (sourceAlpha <= 0) continue;
      const targetAlpha = base.data[targetIndex + 3] / 255;
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const source = overlay.data[sourceIndex + channel] / 255;
        const target = base.data[targetIndex + channel] / 255;
        base.data[targetIndex + channel] = Math.round(((source * sourceAlpha + target * targetAlpha * (1 - sourceAlpha)) / outputAlpha) * 255);
      }
      base.data[targetIndex + 3] = Math.round(outputAlpha * 255);
    }
  }
}

function roundedSolid(width, height, radius, color) {
  const image = new PNG({ width, height });
  const channels = color.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = Math.max(Math.abs(x - width / 2) - (width / 2 - radius), 0);
      const dy = Math.max(Math.abs(y - height / 2) - (height / 2 - radius), 0);
      const index = (y * width + x) * 4;
      if (dx * dx + dy * dy <= radius * radius) {
        image.data[index] = channels[0];
        image.data[index + 1] = channels[1];
        image.data[index + 2] = channels[2];
        image.data[index + 3] = 255;
      }
    }
  }
  return image;
}

const basePath = process.argv[2] || 'tmp/appstore/stockly-base-portrait.png';
const outputPath = process.argv[3] || 'tmp/appstore/stockly-appstore-1284x2778.png';
const screenPath = process.argv[10] || '/Users/jinkim/Downloads/IMG_6534.PNG';
const screenLeft = Number(process.argv[4] ?? 250);
const screenTop = Number(process.argv[5] ?? 1215);
const screenWidth = Number(process.argv[6] ?? 784);
const screenHeight = Number(process.argv[7] ?? 1420);
const islandLeft = Number(process.argv[8] ?? 548);
const islandTop = Number(process.argv[9] ?? 1200);
const base = readPng(basePath);
const logo = resizeBilinear(readPng('public/stockly-login-logo.png'), 360, 148);
const screen = roundedMask(resizeBilinear(readPng(screenPath), screenWidth, screenHeight), 84);
const dynamicIsland = roundedSolid(188, 44, 22, '#0a0d1e');
alphaOver(base, logo, 94, 118);
alphaOver(base, screen, screenLeft, screenTop);
alphaOver(base, dynamicIsland, islandLeft, islandTop);
fs.writeFileSync(outputPath, PNG.sync.write(base));
