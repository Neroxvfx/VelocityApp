import * as FileSystem from 'expo-file-system';

export const BASE = FileSystem.documentDirectory + 'velocity/projects/';
export const FPS_BUTTONS = ['24', '25', '30', '60'];
export const RES_PRESETS = [
  { label: '1080x1920', w: '1080', h: '1920' },
  { label: '720x1280', w: '720', h: '1280' },
  { label: '1080x1080', w: '1080', h: '1080' },
  { label: '1920x1080', w: '1920', h: '1080' },
];

export const toPath = (uri) => uri.replace('file://', '');

export function checkSettings(fpsText, wText, hText) {
  const fps = parseFloat(fpsText);
  const w = parseInt(wText, 10);
  const h = parseInt(hText, 10);
  if (isNaN(fps) || fps < 1 || fps > 120) {
    return { error: 'Frame rate must be a number from 1 to 120.' };
  }
  if (isNaN(w) || isNaN(h) || w < 64 || h < 64 || w > 4096 || h > 4096) {
    return { error: 'Width and height must be numbers from 64 to 4096.' };
  }
  return { fps: fps, w: Math.floor(w / 2) * 2, h: Math.floor(h / 2) * 2 };
}

export function defaultSegs(len) {
  if (len > 0) {
    const third = len / 3;
    return [
      { start: '0', end: third.toFixed(2), speed: '1' },
      { start: third.toFixed(2), end: (third * 2).toFixed(2), speed: '0.25' },
      { start: (third * 2).toFixed(2), end: len.toFixed(2), speed: '2' },
    ];
  }
  return [{ start: '0', end: '5', speed: '1' }];
}

// Upgrades older projects: parts and smoothing move onto each clip
export function normalizeProject(p) {
  const clips = (p.clips || []).map((c) => ({
    ...c,
    id: c.id || c.file,
    segs: c.segs || p.segs || defaultSegs(c.duration || 0),
    mode: c.mode || p.mode || 'off',
  }));
  const rest = { ...p };
  delete rest.segs;
  delete rest.mode;
  return { ...rest, clips: clips };
}

export async function loadProjects() {
  try {
    const info = await FileSystem.getInfoAsync(BASE);
    if (!info.exists) return [];
    const names = await FileSystem.readDirectoryAsync(BASE);
    const list = [];
    for (let i = 0; i < names.length; i++) {
      try {
        const txt = await FileSystem.readAsStringAsync(BASE + names[i] + '/project.json');
        list.push(normalizeProject(JSON.parse(txt)));
      } catch (e) {}
    }
    list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return list;
  } catch (e) {
    return [];
  }
}

export async function saveProject(p) {
  await FileSystem.makeDirectoryAsync(BASE + p.id + '/', { intermediates: true });
  const data = { ...p, updated: Date.now() };
  await FileSystem.writeAsStringAsync(BASE + p.id + '/project.json', JSON.stringify(data));
}
