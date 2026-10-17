import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Video, ResizeMode } from 'expo-av';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';
import styles from './styles';
import { BASE, toPath, checkSettings } from './helpers';
import { extractAudioFrom } from './audioTools';

export default function ClipPanel({ project, clip, index, change, busy, setBusy, onRemoved }) {
  const [resultUri, setResultUri] = useState(null);
  const [resultKey, setResultKey] = useState(0);
  const [log, setLog] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const clipUri = BASE + project.id + '/' + clip.file;
  const segs = clip.segs || [];
  const mode = clip.mode || 'off';
  const seconds = clip.duration ? clip.duration.toFixed(1) : '?';
  const mb = clip.size ? (clip.size / 1048576).toFixed(1) : '?';

  const addLog = (line) => setLog((old) => [...old, line]);

  const changeClip = (fn) => {
    change((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === clip.id ? fn(c) : c)),
    }));
  };

  const updateSeg = (i, field, value) => {
    changeClip((c) => ({
      ...c,
      segs: c.segs.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    }));
  };

  const addSeg = () => {
    const len = clip.duration ? clip.duration : 5;
    const last = segs.length > 0 ? segs[segs.length - 1].end : '0';
    changeClip((c) => ({
      ...c,
      segs: [...c.segs, { start: String(last), end: len.toFixed(2), speed: '1' }],
    }));
  };

  const removeSeg = (i) => {
    changeClip((c) => ({ ...c, segs: c.segs.filter((s, idx) => idx !== i) }));
  };

  const setMode = (key) => {
    changeClip((c) => ({ ...c, mode: key }));
  };

  const extractAudio = async () => {
    if (busy) return;
    setBusy(true);
    setLog(['Extracting audio...']);
    try {
      const item = await extractAudioFrom(project, clip, index);
      change((p) => ({ ...p, audios: [...(p.audios || []), item] }));
      setLog(['Done. The sound was added as a new audio layer.']);
    } catch (e) {
      setLog([String(e.message || e)]);
    }
    setBusy(false);
  };

  const removeClip = () => {
    if (busy) return;
    Alert.alert('Remove layer?', 'This clip and its remap parts will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await FileSystem.deleteAsync(BASE + project.id + '/' + clip.file, { idempotent: true });
          } catch (e) {}
          change((p) => ({ ...p, clips: p.clips.filter((x) => x.id !== clip.id) }));
          onRemoved();
        },
      },
    ]);
  };

  const saveToGallery = async () => {
    if (!resultUri || saving) return;
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission needed',
          'Velocity needs permission to save to your gallery. Please allow it and try again.'
        );
        setSaving(false);
        return;
      }
      await MediaLibrary.saveToLibraryAsync(resultUri);
      setSaved(true);
      Alert.alert('Saved', 'The video is now in your gallery.');
    } catch (e) {
      Alert.alert('Could not save', String(e));
    }
    setSaving(false);
  };

  const applyRemap = async () => {
    if (busy) return;

    if (segs.length === 0) {
      Alert.alert('No parts', 'Add at least one part.');
      return;
    }

    const settings = checkSettings(project.fps, project.width, project.height);
    if (settings.error) {
      Alert.alert('Check project settings', settings.error);
      return;
    }
    const fps = settings.fps;
    const W = settings.w;
    const H = settings.h;

    const nums = [];
    for (let i = 0; i < segs.length; i++) {
      const st = parseFloat(segs[i].start);
      const en = parseFloat(segs[i].end);
      const sp = parseFloat(segs[i].speed);
      if (isNaN(st) || isNaN(en) || isNaN(sp)) {
        Alert.alert('Check part ' + (i + 1), 'Every box needs a number.');
        return;
      }
      if (st < 0 || en <= st) {
        Alert.alert('Check part ' + (i + 1), 'End must be bigger than start.');
        return;
      }
      if (sp < 0.1 || sp > 10) {
        Alert.alert('Check part ' + (i + 1), 'Speed must be between 0.1 and 10.');
        return;
      }
      nums.push({ st: st, en: en, sp: sp });
    }

    setBusy(true);
    setLog([]);
    setResultUri(null);
    setSaved(false);
    const startedAt = Date.now();
    try {
      const input = toPath(clipUri);
      const outDir = BASE + project.id + '/exports/';
      await FileSystem.makeDirectoryAsync(outDir, { intermediates: true });
      const output = toPath(outDir) + 'remap_' + Date.now() + '.mp4';

      addLog('Project: ' + fps + ' fps, ' + W + ' x ' + H + '. Smoothing: ' + mode);

      const parts = [];
      const labels = [];
      let expected = 0;
      nums.forEach((n, i) => {
        let chain =
          '[0:v]trim=start=' + n.st + ':end=' + n.en +
          ',setpts=(PTS-STARTPTS)/' + n.sp;
        if (n.sp < 1 && mode === 'blend') {
          chain += ',minterpolate=fps=' + fps + ':mi_mode=blend';
        } else if (n.sp < 1 && mode === 'smooth') {
          chain += ',minterpolate=fps=' + fps + ':mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1';
        }
        chain += ',fps=' + fps + '[v' + i + ']';
        parts.push(chain);
        labels.push('[v' + i + ']');
        expected += (n.en - n.st) / n.sp;
      });
      const filter =
        parts.join(';') + ';' +
        labels.join('') + 'concat=n=' + nums.length + ':v=1:a=0[cat];' +
        '[cat]scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,' +
        'pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2,setsar=1[out]';

      const cmd =
        '-y -i "' + input + '" -filter_complex "' + filter +
        '" -map "[out]" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "' + output + '"';

      addLog('Working... this can take a while with Smooth.');
      const session = await FFmpegKit.execute(cmd);
      const rc = await session.getReturnCode();
      if (!ReturnCode.isSuccess(rc)) {
        const logs = await session.getAllLogsAsString();
        addLog('FAILED. Last part of the log:');
        addLog(String(logs).slice(-800));
        setBusy(false);
        return;
      }

      const probe = await FFprobeKit.getMediaInformation(output);
      const info = await probe.getMediaInformation();
      const dur = parseFloat(info.getDuration());
      const took = ((Date.now() - startedAt) / 1000).toFixed(1);
      addLog('Done in ' + took + 's. Expected length: ' + expected.toFixed(2) + 's, actual: ' + dur.toFixed(2) + 's');

      setResultUri('file://' + output);
      setResultKey((k) => k + 1);
    } catch (e) {
      addLog('Error: ' + String(e));
    }
    setBusy(false);
  };

  const modeButton = (key, label) => (
    <TouchableOpacity
      key={key}
      style={[styles.modeBtn, mode === key && styles.modeActive]}
      onPress={() => setMode(key)}
    >
      <Text style={styles.modeText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.label}>Clip {index + 1}</Text>
      <Text style={styles.line}>
        {mb} MB, {clip.width} x {clip.height}, {seconds} seconds
      </Text>
      <Video
        style={[styles.player, { height: 200 }]}
        source={{ uri: clipUri }}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        isLooping
      />

      <Text style={styles.label}>Time remap parts</Text>
      <View style={styles.row}>
        <Text style={[styles.head, styles.cell]}>Start (s)</Text>
        <Text style={[styles.head, styles.cell]}>End (s)</Text>
        <Text style={[styles.head, styles.cell]}>Speed</Text>
        <View style={styles.xcell} />
      </View>
      {segs.map((s, i) => (
        <View key={i} style={styles.row}>
          <TextInput
            style={[styles.input, styles.cell]}
            value={s.start}
            keyboardType="decimal-pad"
            onChangeText={(t) => updateSeg(i, 'start', t)}
          />
          <TextInput
            style={[styles.input, styles.cell]}
            value={s.end}
            keyboardType="decimal-pad"
            onChangeText={(t) => updateSeg(i, 'end', t)}
          />
          <TextInput
            style={[styles.input, styles.cell]}
            value={s.speed}
            keyboardType="decimal-pad"
            onChangeText={(t) => updateSeg(i, 'speed', t)}
          />
          <TouchableOpacity style={styles.xcell} onPress={() => removeSeg(i)}>
            <Text style={styles.xText}>X</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={styles.addBtn} onPress={addSeg}>
        <Text style={styles.buttonText}>+ Add part</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Smoothing for slow parts</Text>
      <View style={styles.modeRow}>
        {modeButton('off', 'Off')}
        {modeButton('blend', 'Blend')}
        {modeButton('smooth', 'Smooth')}
      </View>

      <TouchableOpacity
        style={[styles.button, styles.apply, busy && styles.disabled]}
        onPress={applyRemap}
      >
        <Text style={styles.buttonText}>{busy ? 'Working...' : 'Apply time remap'}</Text>
      </TouchableOpacity>

      {log.map((line, i) => (
        <Text key={i} style={styles.logLine}>
          {line}
        </Text>
      ))}

      {resultUri ? (
        <View>
          <Text style={styles.label}>Result</Text>
          <Video
            key={String(resultKey)}
            style={styles.player}
            source={{ uri: resultUri }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            isLooping
          />
          <TouchableOpacity
            style={[styles.button, styles.saveBtn, (saving || saved) && styles.disabled]}
            onPress={saveToGallery}
          >
            <Text style={styles.buttonText}>
              {saving ? 'Saving...' : saved ? 'Saved to gallery' : 'Save to gallery'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.addBtn, { marginTop: 14 }, busy && styles.disabled]}
        onPress={extractAudio}
      >
        <Text style={styles.buttonText}>Extract audio to a new layer</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.addBtn, { marginTop: 10 }]} onPress={removeClip}>
        <Text style={[styles.buttonText, { color: '#f87171' }]}>Remove this layer</Text>
      </TouchableOpacity>
    </View>
  );
}
