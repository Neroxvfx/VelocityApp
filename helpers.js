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

// Length of a clip after its time remap parts (falls back to the original length)
export function remapLength(clip) {
  const segs = clip.segs || [];
  let total = 0;
  for (let i = 0; i < segs.length; i++) {
    const st = parseFloat(segs[i].start);
    const en = parseFloat(segs[i].end);
    const sp = parseFloat(segs[i].speed);
    if (isNaN(st) || isNaN(en) || isNaN(sp) || sp <= 0 || en <= st) {
      return clip.duration || 0;
    }
    total += (en - st) / sp;
  }
  return total > 0 ? total : clip.duration || 0;
}

// How many seconds the timeline should cover
export function timelineSeconds(project) {
  let maxEnd = 0;
  (project.clips || []).forEach((c) => {
    maxEnd = Math.max(maxEnd, (c.start || 0) + remapLength(c));
  });
  (project.audios || []).forEach((a) => {
    maxEnd = Math.max(maxEnd, (a.start || 0) + (a.duration || 0));
  });
  return Math.max(10, Math.ceil(maxEnd) + 5);
}

export function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

export function snapFrame(t, fps) {
  return Math.max(0, Math.round(t * fps) / fps);
}

// After Effects style timecode: h:mm:ss:ff
export function fmtTimecode(t, fps) {
  const nominal = Math.max(1, Math.round(fps));
  const frame = Math.max(0, Math.round(t * fps));
  const sec = Math.floor(frame / nominal);
  const ff = frame % nominal;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h + ':' + pad2(m) + ':' + pad2(s) + ':' + pad2(ff);
}

function uniqueSorted(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (out.length === 0 || s[i] - out[out.length - 1] > 0.0005) out.push(s[i]);
  }
  return out;
}

// Places the jump buttons can stop at
export function jumpTargets(project, selected, fps) {
  const clips = project.clips || [];
  const audios = project.audios || [];
  if (selected) {
    const list = selected.type === 'clip' ? clips : audios;
    let layer = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === selected.id) layer = list[i];
    }
    // Keyframes (used once keyframes exist): only the selected layer's keyframes
    if (layer && layer.keys && layer.keys.length > 0) {
      return uniqueSorted(
        layer.keys.map((k) => snapFrame((layer.start || 0) + k.t, fps))
      );
    }
  }
  const all = [0];
  clips.forEach((c) => {
    const s = c.start || 0;
    all.push(snapFrame(s, fps));
    all.push(snapFrame(s + remapLength(c), fps));
  });
  audios.forEach((a) => {
    (a.beats || []).forEach((b) => all.push(snapFrame((a.start || 0) + b, fps)));
  });
  return uniqueSorted(all);
}

export function nextTarget(list, t) {
  for (let i = 0; i < list.length; i++) {
    if (list[i] > t + 0.0005) return list[i];
  }
  return null;
}

export function prevTarget(list, t) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] < t - 0.0005) return list[i];
  }
  return null;
}

// ---------- audio layer helpers ----------
export function updateAudio(change, id, fn) {
  change((p) => ({
    ...p,
    audios: (p.audios || []).map((x) => (x.id === id ? fn(x) : x)),
  }));
}

export function addBeat(change, id, t) {
  updateAudio(change, id, (x) => {
    const beats = x.beats || [];
    for (let i = 0; i < beats.length; i++) {
      if (Math.abs(beats[i] - t) < 0.0005) return x;
    }
    return { ...x, beats: [...beats, t].sort((a, b) => a - b) };
  });
}

export function removeBeatIndex(change, id, idx) {
  updateAudio(change, id, (x) => ({
    ...x,
    beats: (x.beats || []).filter((b, i) => i !== idx),
  }));
}

export function clearBeats(change, id) {
  updateAudio(change, id, (x) => ({ ...x, beats: [] }));
}

// Upgrades older projects to the newest layout
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
  return { ...rest, clips: clips, audios: p.audios || [] };
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
