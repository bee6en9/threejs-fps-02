// Procedural textures: every surface is painted on a canvas at load, so the
// game ships no image files and loads nothing over the network. Each texture
// gets its own canvas — a CanvasTexture keeps a live reference to its canvas,
// so sharing one would repaint every texture with the last design.
import * as THREE from 'three';

function make(size, painter) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  painter(c, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function speckle(c, size, n, alpha, light, dark) {
  for (let i = 0; i < n; i += 1) {
    const v = Math.random();
    c.fillStyle = v > 0.5 ? light : dark;
    c.globalAlpha = alpha * Math.random();
    c.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  c.globalAlpha = 1;
}

function rustStreaks(c, size, n) {
  for (let i = 0; i < n; i += 1) {
    const x = Math.random() * size;
    const w = 2 + Math.random() * 8;
    const h = 10 + Math.random() * 60;
    const g = c.createLinearGradient(x, 0, x, h);
    g.addColorStop(0, 'rgba(90, 50, 25, 0.5)');
    g.addColorStop(1, 'rgba(90, 50, 25, 0)');
    c.fillStyle = g;
    c.fillRect(x, Math.random() * size * 0.5, w, h);
  }
}

function corrugated(base, rib, dark) {
  return make(256, (c, s) => {
    c.fillStyle = base;
    c.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      c.fillStyle = rib;
      c.fillRect(x, 0, 7, s);
      c.fillStyle = dark;
      c.fillRect(x + 7, 0, 3, s);
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.fillRect(x + 10, 0, 2, s);
    }
    speckle(c, s, 500, 0.16, '#ffffff', '#000000');
    rustStreaks(c, s, 14);
  });
}

export function createTextures() {
  const concrete = make(256, (c, s) => {
    c.fillStyle = '#6f7276';
    c.fillRect(0, 0, s, s);
    speckle(c, s, 2600, 0.2, '#9a9da0', '#3c3f43');
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, s - 2, s - 2);
    c.beginPath();
    c.moveTo(0, s / 2);
    c.lineTo(s, s / 2);
    c.stroke();
  });
  const asphalt = make(256, (c, s) => {
    c.fillStyle = '#33373b';
    c.fillRect(0, 0, s, s);
    speckle(c, s, 3200, 0.25, '#565b60', '#17191c');
    c.strokeStyle = 'rgba(255,176,46,0.55)';
    c.lineWidth = 5;
    c.setLineDash([26, 22]);
    c.beginPath();
    c.moveTo(0, s / 2);
    c.lineTo(s, s / 2);
    c.stroke();
    c.setLineDash([]);
  });
  const hazard = make(256, (c, s) => {
    c.fillStyle = '#e8a91c';
    c.fillRect(0, 0, s, s);
    c.fillStyle = '#17181a';
    for (let x = -s; x < s * 2; x += 64) {
      c.beginPath();
      c.moveTo(x, s);
      c.lineTo(x + 32, 0);
      c.lineTo(x + 64, 0);
      c.lineTo(x + 32, s);
      c.closePath();
      c.fill();
    }
    speckle(c, s, 400, 0.15, '#ffffff', '#000000');
  });
  const wood = make(256, (c, s) => {
    c.fillStyle = '#7a5a34';
    c.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 42) {
      c.fillStyle = y % 84 === 0 ? '#84643a' : '#6f4f2c';
      c.fillRect(0, y, s, 40);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(0, y, s, 2);
      for (let i = 0; i < 5; i += 1) {
        c.strokeStyle = 'rgba(40,25,10,0.5)';
        c.beginPath();
        const yy = y + 6 + Math.random() * 30;
        c.moveTo(0, yy);
        c.bezierCurveTo(s * 0.3, yy + 3, s * 0.6, yy - 3, s, yy + 2);
        c.stroke();
      }
    }
    speckle(c, s, 300, 0.12, '#ffffff', '#000000');
  });
  const roof = make(256, (c, s) => {
    c.fillStyle = '#4a4f55';
    c.fillRect(0, 0, s, s);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    for (let x = 0; x < s; x += 32) c.fillRect(x, 0, 2, s);
    speckle(c, s, 900, 0.18, '#8a8f96', '#23262a');
    rustStreaks(c, s, 10);
  });
  const site = make(256, (c, s) => {
    c.fillStyle = '#2a2e33';
    c.fillRect(0, 0, s, s);
    c.strokeStyle = '#ffb02e';
    c.lineWidth = 10;
    c.strokeRect(14, 14, s - 28, s - 28);
    c.fillStyle = '#ffb02e';
    c.font = 'bold 92px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('A', s / 2, s / 2 + 4);
  });
  const siteB = make(256, (c, s) => {
    c.fillStyle = '#2a2e33';
    c.fillRect(0, 0, s, s);
    c.strokeStyle = '#2dd4bf';
    c.lineWidth = 10;
    c.strokeRect(14, 14, s - 28, s - 28);
    c.fillStyle = '#2dd4bf';
    c.font = 'bold 92px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('B', s / 2, s / 2 + 4);
  });
  return {
    concrete,
    asphalt,
    hazard,
    wood,
    roof,
    site,
    siteB,
    containerTeal: corrugated('#2f8a84', '#3aa39c', '#1a4a46'),
    containerRust: corrugated('#9a5527', '#b4652f', '#5c2f16'),
    containerSlate: corrugated('#55677a', '#66788c', '#2e3a46'),
    containerAmber: corrugated('#a3862a', '#b89a38', '#63501a'),
  };
}
