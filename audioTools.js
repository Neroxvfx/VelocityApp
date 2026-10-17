import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { BASE, toPath } from './helpers';

export async function getDuration(path) {
  try {
    const probe = await FFprobeKit.getMediaInformation(path);
    const info = await probe.getMediaInformation();
    const d = parseFloat(info.getDuration());
    return isNaN(d) ? 0 : d;
  } catch (e) {
    return 0;
  }
}

export async function getSampleRate(path) {
  try {
    const probe = await FFprobeKit.getMediaInformation(path);
    const info = await probe.getMediaInformation();
    const streams = info.getStreams() || [];
    const a = streams.find((st) => st.getType() === 'audio');
    const sr = a ? parseInt(a.getSampleRate(), 10) : 0;
    return sr > 0 ? sr : 44100;
  } catch (e) {
    return 44100;
  }
}

// Draws the waveform picture. Returns { wave, waveW } or null if it failed.
export async function makeWave(project, item) {
  try {
    const width = Math.round(Math.min(4000, Math.max(800, (item.duration || 0) * 80)));
    const waveFile = 'wave_' + item.id + '.png';
    const outUri = BASE + project.id + '/' + waveFile;
    const cmd =
      '-y -i "' + toPath(BASE + project.id + '/' + item.file) + '"' +
      ' -filter_complex "aformat=channel_layouts=mono,showwavespic=s=' +
      width + 'x160:colors=dodgerblue"' +
      ' -frames:v 1 "' + toPath(outUri) + '"';
    const session = await FFmpegKit.execute(cmd);
    const rc = await session.getReturnCode();
    if (!ReturnCode.isSuccess(rc)) return null;
    return { wave: waveFile, waveW: width };
  } catch (e) {
    return null;
  }
}

async function withWave(project, item) {
  const w = await makeWave(project, item);
  return w ? { ...item, ...w } : item;
}

// Returns the new audio item, or null if the picker was cancelled
export async function importAudioFile(project) {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const stamp = Date.now();
  const nameText = asset.name || 'Imported audio';
  const m = nameText.match(/\.([a-zA-Z0-9]{1,5})$/);
  const ext = m ? m[1].toLowerCase() : 'm4a';
  const file = 'audio_' + stamp + '.' + ext;
  const outUri = BASE + project.id + '/' + file;
  await FileSystem.copyAsync({ from: asset.uri, to: outUri });
  try {
    await FileSystem.deleteAsync(asset.uri, { idempotent: true });
  } catch (e) {}
  const dur = await getDuration(toPath(outUri));
  const item = {
    id: 'a' + stamp,
    file: file,
    name: nameText.replace(/\.[a-zA-Z0-9]{1,5}$/, ''),
    duration: dur,
    start: 0,
    beats: [],
  };
  return withWave(project, item);
}

export async function extractAudioFrom(project, clip, index) {
  const stamp = Date.now();
  const file = 'audio_' + stamp + '.m4a';
  const outUri = BASE + project.id + '/' + file;
  const cmd =
    '-y -i "' + toPath(BASE + project.id + '/' + clip.file) +
    '" -vn -c:a aac -b:a 192k "' + toPath(outUri) + '"';
  const session = await FFmpegKit.execute(cmd);
  const rc = await session.getReturnCode();
  if (!ReturnCode.isSuccess(rc)) {
    try {
      await FileSystem.deleteAsync(outUri, { idempotent: true });
    } catch (e) {}
    throw new Error('No audio could be extracted. This clip may have no sound.');
  }
  const dur = await getDuration(toPath(outUri));
  const item = {
    id: 'a' + stamp,
    file: file,
    name: 'Audio from Clip ' + (index + 1),
    duration: dur,
    start: clip.start || 0,
    beats: [],
  };
  return withWave(project, item);
}

export async function makeSpeedCopy(project, audio, sp, pitchMode) {
  const inPath = toPath(BASE + project.id + '/' + audio.file);
  let filter;
  if (pitchMode === 'keep') {
    // atempo only works between 0.5 and 100, so slow speeds are chained
    const parts = [];
    let s = sp;
    while (s < 0.5) {
      parts.push('atempo=0.5');
      s = s / 0.5;
    }
    parts.push('atempo=' + s.toFixed(6));
    filter = parts.join(',');
  } else {
    const sr = await getSampleRate(inPath);
    filter = 'asetrate=' + Math.round(sr * sp) + ',aresample=' + sr;
  }
  const stamp = Date.now();
  const file = 'audio_' + stamp + '.m4a';
  const outUri = BASE + project.id + '/' + file;
  const cmd =
    '-y -i "' + inPath + '" -vn -filter:a "' + filter +
    '" -c:a aac -b:a 192k "' + toPath(outUri) + '"';
  const session = await FFmpegKit.execute(cmd);
  const rc = await session.getReturnCode();
  if (!ReturnCode.isSuccess(rc)) {
    try {
      await FileSystem.deleteAsync(outUri, { idempotent: true });
    } catch (e) {}
    const logs = await session.getAllLogsAsString();
    throw new Error('Speed change failed. ' + String(logs).slice(-300));
  }
  const dur = await getDuration(toPath(outUri));
  const label = String(parseFloat(sp.toFixed(3))) + 'x' + (pitchMode === 'keep' ? '' : ' pitch');
  const item = {
    id: 'a' + stamp,
    file: file,
    name: audio.name + ' ' + label,
    duration: dur,
    start: audio.start || 0,
    beats: [],
  };
  return withWave(project, item);
}
