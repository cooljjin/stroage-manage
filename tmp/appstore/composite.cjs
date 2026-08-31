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

const base = readPng('tmp/appstore/stockly-base.png');
const logo = resizeBilinear(readPng('public/stockly-login-logo.png'), 370, 152);
const screen = resizeBilinear(readPng('/Users/jinkim/Downloads/IMG_6534.PNG'), 520, 1126);
alphaOver(base, logo, 188, 112);
alphaOver(base, screen, 1920, 104);
fs.writeFileSync('tmp/appstore/stockly-appstore-2778x1284.png', PNG.sync.write(base));
