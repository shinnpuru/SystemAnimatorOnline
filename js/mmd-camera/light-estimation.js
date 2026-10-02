const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;

// A single ordinary photo cannot recover a physical light field. Estimate a
// useful starting point from neutral bright pixels and their screen centroid.
// Keep uncertainty visible, particularly for evenly lit or very dark frames.
export function estimateLighting({ data, width, height }) {
  if (!width || !height || data.length !== width * height * 4) throw new Error('Invalid image pixels');
  const samples = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]].map(value => value / 255);
    const [r, g, b] = rgb.map(linear), luminance = .2126 * r + .7152 * g + .0722 * b;
    const saturation = (Math.max(...rgb) - Math.min(...rgb)) / Math.max(.01, ...rgb);
    samples.push({ x: (x + .5) / width * 2 - 1, y: 1 - (y + .5) / height * 2, r, g, b, luminance, saturation });
  }
  if (!samples.length) throw new Error('No visible image pixels');
  const sorted = samples.map(sample => sample.luminance).sort((a, b) => a - b);
  const percentile = amount => sorted[Math.floor((sorted.length - 1) * amount)];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const spread = percentile(.95) - percentile(.1), threshold = percentile(.65);
  let weight = 0, x = 0, y = 0, red = 0, blue = 0, colorWeight = 0;
  for (const sample of samples) {
    const w = Math.max(0, sample.luminance - threshold) ** 2;
    weight += w; x += sample.x * w; y += sample.y * w;
    // Saturated walls/clothes are poor white-balance references; suppress them.
    const neutral = (1 - sample.saturation) ** 3 * Math.max(.005, sample.luminance);
    red += sample.r * neutral; blue += sample.b * neutral; colorWeight += neutral;
  }
  const nx = weight > .00001 ? x / weight : 0, ny = weight > .00001 ? y / weight : 0;
  const directional = mean > .015 && spread > .10 && Math.hypot(nx, ny) > .09;
  const temperature = colorWeight ? clamp(6500 - 2400 * Math.log((red + .001) / (blue + .001)), 2700, 9500) : 6500;
  return {
    intensity: Math.round(clamp(.5 + Math.sqrt(mean) * 1.7, .45, 2.2) * 100),
    ambient: Math.round(clamp(.72 - spread * .48, .22, .75) * 100),
    azimuth: directional ? Math.round(Math.atan2(nx, .65) * 180 / Math.PI) : -25,
    elevation: directional ? Math.round(clamp(25 + ny * 50, 5, 75)) : 35,
    temperature: Math.round(temperature / 100) * 100,
    contrast: Math.round(clamp(.32 + spread * .5, .3, .8) * 100),
    confidence: mean <= .015 ? 'dark' : directional ? 'directional' : 'diffuse'
  };
}

export const defaultLighting = Object.freeze({ intensity: 100, ambient: 45, azimuth: -30, elevation: 35, temperature: 5800, contrast: 60, rim: 35, outline: 30, exposure: 100 });

// Approximate black-body RGB, for an artistic warm/cool light control.
export function temperatureRGB(kelvin) {
  const t = clamp(kelvin, 2000, 10000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map(value => clamp(value, 0, 255) / 255);
}
