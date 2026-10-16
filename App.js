import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Video, ResizeMode } from 'expo-av';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';

export default function App() {
  const [video, setVideo] = useState(null);
  const [segs, setSegs] = useState([]);
  const [mode, setMode] = useState('off');
  const [resultUri, setResultUri] = useState(null);
  const [resultKey, setResultKey] = useState(0);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addLog = (line) => setLog((old) => [...old, line]);
  const toPath = (uri) => uri.replace('file://', '');

  const pickVideo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        setVideo(asset);
        setResultUri(null);
        setSaved(false);
        setLog([]);
        const len = asset.duration ? asset.duration / 1000 : 0;
        if (len > 0) {
          const third = len / 3;
          setSegs([
            { start: '0', end: third.toFixed(2), speed: '1' },
            { start: third.toFixed(2), end: (third * 2).toFixed(2), speed: '0.25' },
            { start: (third * 2).toFixed(2), end: len.toFixed(2), speed: '2' },
          ]);
        } else {
          setSegs([{ start: '0', end: '5', speed: '1' }]);
        }
      }
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const updateSeg = (i, field, value) => {
    setSegs((old) => old.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };

  const addSeg = () => {
    const len = video && video.duration ? video.duration / 1000 : 5;
    const last = segs.length > 0 ? segs[segs.length - 1].end : '0';
    setSegs((old) => [...old, { start: String(last), end: len.toFixed(2), speed: '1' }]);
  };

  const removeSeg = (i) => {
    setSegs((old) => old.filter((s, idx) => idx !== i));
  };

  const seconds = video && video.duration ? (video.duration / 1000).toFixed(1) : '?';
  const mb = video && video.fileSize ? (video.fileSize / 1048576).toFixed(1) : '?';

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
    if (!video || busy) return;

    if (segs.length === 0) {
      Alert.alert('No parts', 'Add at least one part.');
      return;
    }

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
      const input = toPath(video.uri);
      const output = input.replace(/[^/]+$/, 'velocity_remap_' + Date.now() + '.mp4');

      // Find the video's frame rate
      let fps = 30;
      try {
        const probe0 = await FFprobeKit.getMediaInformation(input);
        const info0 = await probe0.getMediaInformation();
        const streams = info0.getStreams() || [];
        const vs = streams.find((st) => st.getType() === 'video');
        const r = vs ? vs.getAverageFrameRate() : null;
        if (r) {
          const bits = String(r).split('/');
          const val = bits.length === 2 ? parseFloat(bits[0]) / parseFloat(bits[1]) : parseFloat(bits[0]);
          if (!isNaN(val) && val >= 10) {
            fps = Math.min(Math.round(val), 60);
          }
        }
      } catch (e) {
        fps = 30;
      }
      addLog('Frame rate: ' + fps + ' fps. Smoothing: ' + mode);

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
        '[cat]scale=trunc(iw/2)*2:trunc(ih/2)*2[out]';

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
    <View style={styles.container}>
      <Text style={styles.title}>Velocity</Text>

      <TouchableOpacity style={styles.button} onPress={pickVideo}>
        <Text style={styles.buttonText}>Pick a video</Text>
      </TouchableOpacity>

      <ScrollView style={styles.info} keyboardShouldPersistTaps="handled">
        {video ? (
          <View>
            <Text style={styles.line}>
              {mb} MB, {video.width} x {video.height}, {seconds} seconds
            </Text>
            <Text style={styles.label}>Original</Text>
            <Video
              style={styles.player}
              source={{ uri: video.uri }}
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
          </View>
        ) : (
          <Text style={styles.line}>No video picked yet.</Text>
        )}

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

        <View style={{ height: 80 }} />
      </ScrollView>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    paddingTop: 70,
    paddingHorizontal: 20,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  apply: {
    marginTop: 14,
    backgroundColor: '#22c55e',
  },
  saveBtn: {
    backgroundColor: '#8b5cf6',
  },
  addBtn: {
    backgroundColor: '#444',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  disabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  info: {
    marginTop: 24,
  },
  line: {
    color: '#ddd',
    fontSize: 16,
    marginBottom: 10,
  },
  label: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 8,
  },
  player: {
    width: '100%',
    height: 240,
    backgroundColor: '#000',
    borderRadius: 8,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cell: {
    flex: 1,
    marginRight: 8,
  },
  xcell: {
    width: 36,
    alignItems: 'center',
  },
  head: {
    color: '#aaa',
    fontSize: 13,
  },
  input: {
    backgroundColor: '#222',
    color: '#fff',
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  xText: {
    color: '#f87171',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  modeBtn: {
    flex: 1,
    backgroundColor: '#222',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8,
  },
  modeActive: {
    backgroundColor: '#3b82f6',
  },
  modeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logLine: {
    color: '#facc15',
    fontSize: 14,
    marginBottom: 8,
  },
});
