import React, { useState, useEffect, useRef } from 'react';
import { Text, View, TouchableOpacity, Alert, Image, ScrollView } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';
import styles from './styles';
import { BASE, toPath } from './helpers';

const WAVE_H = 160;

export default function AudioSection({ project, clip, clipUri, change, busy, setBusy }) {
  const [playingId, setPlayingId] = useState(null);
  const [waveOpenId, setWaveOpenId] = useState(null);
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
            <TouchableOpacity style={styles.xcell} onPress={() => removeAudio(a)}>
              <Text style={styles.xText}>X</Text>
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
