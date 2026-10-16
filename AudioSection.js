import React, { useState, useEffect, useRef } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
  TextInput,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';
import styles from './styles';
import { BASE, toPath } from './helpers';

const WAVE_H = 160;
const SPEED_CHIPS = ['0.5', '1.5', '2'];

export default function AudioSection({ project, clip, clipUri, change, busy, setBusy }) {
  const [playingId, setPlayingId] = useState(null);
  const [waveOpenId, setWaveOpenId] = useState(null);
  const [speedOpenId, setSpeedOpenId] = useState(null);
  const [speedText, setSpeedText] = useState('1.5');
  const [pitchMode, setPitchMode] = useState('keep');
  const [message, setMessage] = useState('');
  const soundRef = useRef(null);
  const audios = project.audios || [];

  const stopSound = async () => {
    const s = soundRef.current;
    soundRef.current = null;
    setPlayingId(null);
    if (s) {
      try {
        await s.unloadAsync();
      } catch (e) {}
    }
  };

  useEffect(() => {
    return () => {
      const s = soundRef.current;
      if (s) {
        s.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const togglePlay = async (a) => {
    if (playingId === a.id) {
      await stopSound();
      return;
    }
    await stopSound();
    try {
      const created = await Audio.Sound.createAsync(
        { uri: BASE + project.id + '/' + a.file },
        { shouldPlay: true }
      );
      soundRef.current = created.sound;
      setPlayingId(a.id);
      created.sound.setOnPlaybackStatusUpdate((st) => {
        if (st && st.didJustFinish) {
          stopSound();
        }
      });
    } catch (e) {
      Alert.alert('Could not play', String(e));
    }
  };

  const getDuration = async (path) => {
    try {
      const probe = await FFprobeKit.getMediaInformation(path);
      const info = await probe.getMediaInformation();
      const d = parseFloat(info.getDuration());
      return isNaN(d) ? 0 : d;
    } catch (e) {
      return 0;
    }
  };

  const getSampleRate = async (path) => {
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
  };

  const toggleWave = async (a) => {
    if (waveOpenId === a.id) {
      setWaveOpenId(null);
      return;
    }
    if (a.wave) {
      setWaveOpenId(a.id);
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage('Drawing waveform...');
    try {
      const width = Math.round(Math.min(4000, Math.max(800, (a.duration || 0) * 80)));
      const waveFile = 'wave_' + a.id + '.png';
      const outUri = BASE + project.id + '/' + waveFile;
      const cmd =
        '-y -i "' + toPath(BASE + project.id + '/' + a.file) + '"' +
        ' -filter_complex "aformat=channel_layouts=mono,showwavespic=s=' +
        width + 'x' + WAVE_H + ':colors=dodgerblue"' +
        ' -frames:v 1 "' + toPath(outUri) + '"';
      const session = await FFmpegKit.execute(cmd);
      const rc = await session.getReturnCode();
      if (!ReturnCode.isSuccess(rc)) {
        const logs = await session.getAllLogsAsString();
        setMessage('Could not draw the waveform. ' + String(logs).slice(-300));
        setBusy(false);
        return;
      }
      change((p) => ({
        ...p,
        audios: (p.audios || []).map((x) =>
          x.id === a.id ? { ...x, wave: waveFile, waveW: width } : x
        ),
      }));
      setWaveOpenId(a.id);
      setMessage('');
    } catch (e) {
      setMessage('Error: ' + String(e));
    }
    setBusy(false);
  };

  const toggleSpeed = (a) => {
    setSpeedOpenId(speedOpenId === a.id ? null : a.id);
  };

  const createSpeedCopy = async (a) => {
    if (busy) return;
    const sp = parseFloat(String(speedText).replace(',', '.'));
    if (isNaN(sp) || sp < 0.05 || sp > 50) {
      Alert.alert('Check speed', 'Speed must be a number from 0.05 to 50.');
      return;
    }
    if (Math.abs(sp - 1) < 0.0001) {
      Alert.alert('Check speed', 'Speed 1 changes nothing. Type another number.');
      return;
    }
    setBusy(true);
    setMessage('Changing speed...');
    try {
      await stopSound();
      const inPath = toPath(BASE + project.id + '/' + a.file);
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
        setMessage('Speed change failed. ' + String(logs).slice(-300));
        setBusy(false);
        return;
      }
      const dur = await getDuration(toPath(outUri));
      const label = String(parseFloat(sp.toFixed(3))) + 'x' + (pitchMode === 'keep' ? '' : ' pitch');
      const item = {
        id: 'a' + stamp,
        file: file,
        name: a.name + ' ' + label,
        duration: dur,
      };
      change((p) => ({ ...p, audios: [...(p.audios || []), item] }));
      setSpeedOpenId(null);
      setMessage('Done. New audio added: ' + item.name);
    } catch (e) {
      setMessage('Error: ' + String(e));
    }
    setBusy(false);
  };

  const importAudio = async () => {
    if (busy) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setBusy(true);
      setMessage('Importing audio...');
      await stopSound();
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
      };
      change((p) => ({ ...p, audios: [...(p.audios || []), item] }));
      setMessage('Done. Audio imported.');
    } catch (e) {
      setMessage('Error: ' + String(e));
    }
    setBusy(false);
  };

  const extractAudio = async () => {
    if (!clip || busy) return;
    setBusy(true);
    setMessage('Extracting audio...');
    try {
      await stopSound();
      const stamp = Date.now();
      const file = 'audio_' + stamp + '.m4a';
      const outUri = BASE + project.id + '/' + file;
      const output = toPath(outUri);
      const cmd =
        '-y -i "' + toPath(clipUri) + '" -vn -c:a aac -b:a 192k "' + output + '"';
      const session = await FFmpegKit.execute(cmd);
      const rc = await session.getReturnCode();
      if (!ReturnCode.isSuccess(rc)) {
        try {
          await FileSystem.deleteAsync(outUri, { idempotent: true });
        } catch (e) {}
        setMessage('No audio could be extracted. This clip may have no sound.');
        setBusy(false);
        return;
      }
      const dur = await getDuration(output);
      const idx = project.clips.findIndex((c) => c.id === clip.id);
      const item = {
        id: 'a' + stamp,
        file: file,
        name: 'Audio from Clip ' + (idx + 1),
        duration: dur,
      };
      change((p) => ({ ...p, audios: [...(p.audios || []), item] }));
      setMessage('Done. Audio added.');
    } catch (e) {
      setMessage('Error: ' + String(e));
    }
    setBusy(false);
  };

  const removeAudio = (a) => {
    Alert.alert('Remove audio?', '"' + a.name + '" will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (playingId === a.id) await stopSound();
          if (waveOpenId === a.id) setWaveOpenId(null);
          if (speedOpenId === a.id) setSpeedOpenId(null);
          try {
            await FileSystem.deleteAsync(BASE + project.id + '/' + a.file, { idempotent: true });
          } catch (e) {}
          if (a.wave) {
            try {
              await FileSystem.deleteAsync(BASE + project.id + '/' + a.wave, { idempotent: true });
            } catch (e) {}
          }
          change((p) => ({ ...p, audios: (p.audios || []).filter((x) => x.id !== a.id) }));
        },
      },
    ]);
  };

  return (
    <View>
      <Text style={styles.label}>Audio</Text>
      {audios.length === 0 ? <Text style={styles.line}>No audio yet.</Text> : null}
      {audios.map((a) => (
        <View
          key={a.id}
          style={{
            backgroundColor: '#1c1c1c',
            padding: 14,
            borderRadius: 10,
            marginBottom: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={styles.cardInfo}>{(a.duration || 0).toFixed(1)} s</Text>
            </View>
            <TouchableOpacity style={styles.xcell} onPress={() => removeAudio(a)}>
              <Text style={styles.xText}>X</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <TouchableOpacity
              style={[styles.chip, playingId === a.id && styles.modeActive, { marginBottom: 0 }]}
              onPress={() => togglePlay(a)}
            >
              <Text style={styles.chipText}>{playingId === a.id ? 'Stop' : 'Play'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, waveOpenId === a.id && styles.modeActive, { marginBottom: 0 }]}
              onPress={() => toggleWave(a)}
            >
              <Text style={styles.chipText}>Wave</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, speedOpenId === a.id && styles.modeActive, { marginBottom: 0 }]}
              onPress={() => toggleSpeed(a)}
            >
              <Text style={styles.chipText}>Speed</Text>
            </TouchableOpacity>
          </View>

          {waveOpenId === a.id && a.wave ? (
            <ScrollView
              horizontal
              style={{ marginTop: 12, backgroundColor: '#0a0a0a', borderRadius: 8 }}
            >
              <Image
                source={{ uri: BASE + project.id + '/' + a.wave }}
                style={{ width: a.waveW || 800, height: WAVE_H }}
                resizeMode="stretch"
              />
            </ScrollView>
          ) : null}

          {speedOpenId === a.id ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.head}>Speed (0.05 to 50, any number)</Text>
              <TextInput
                style={[styles.inputFull, { marginTop: 6 }]}
                value={speedText}
                keyboardType="decimal-pad"
                onChangeText={setSpeedText}
              />
              <View style={styles.chipRow}>
                {SPEED_CHIPS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, speedText === c && styles.modeActive]}
                    onPress={() => setSpeedText(c)}
                  >
                    <Text style={styles.chipText}>{c}x</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, pitchMode === 'keep' && styles.modeActive]}
                  onPress={() => setPitchMode('keep')}
                >
                  <Text style={styles.modeText}>Keep pitch</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, pitchMode === 'change' && styles.modeActive]}
                  onPress={() => setPitchMode('change')}
                >
                  <Text style={styles.modeText}>Change pitch</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.button, styles.apply, busy && styles.disabled]}
                onPress={() => createSpeedCopy(a)}
              >
                <Text style={styles.buttonText}>Create new audio</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}

      <TouchableOpacity
        style={[styles.button, busy && styles.disabled]}
        onPress={importAudio}
      >
        <Text style={styles.buttonText}>Import audio file</Text>
      </TouchableOpacity>

      {clip ? (
        <TouchableOpacity
          style={[styles.addBtn, { marginTop: 10 }, busy && styles.disabled]}
          onPress={extractAudio}
        >
          <Text style={styles.buttonText}>Extract audio from selected clip</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.hint}>Add a clip to extract its audio.</Text>
      )}
      {message ? <Text style={styles.logLine}>{message}</Text> : null}
    </View>
  );
}
