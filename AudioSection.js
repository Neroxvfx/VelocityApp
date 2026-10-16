import React, { useState, useEffect, useRef } from 'react';
import { Text, View, TouchableOpacity, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';
import styles from './styles';
import { BASE, toPath } from './helpers';

export default function AudioSection({ project, clip, clipUri, change, busy, setBusy }) {
  const [playingId, setPlayingId] = useState(null);
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
      let dur = 0;
      try {
        const probe = await FFprobeKit.getMediaInformation(output);
        const info = await probe.getMediaInformation();
        dur = parseFloat(info.getDuration());
        if (isNaN(dur)) dur = 0;
      } catch (e) {
        dur = 0;
      }
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
          try {
            await FileSystem.deleteAsync(BASE + project.id + '/' + a.file, { idempotent: true });
          } catch (e) {}
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
        <View key={a.id} style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardName}>{a.name}</Text>
            <Text style={styles.cardInfo}>{(a.duration || 0).toFixed(1)} s</Text>
          </View>
          <TouchableOpacity
            style={[styles.chip, playingId === a.id && styles.modeActive, { marginBottom: 0 }]}
            onPress={() => togglePlay(a)}
          >
            <Text style={styles.chipText}>{playingId === a.id ? 'Stop' : 'Play'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.xcell} onPress={() => removeAudio(a)}>
            <Text style={styles.xText}>X</Text>
          </TouchableOpacity>
        </View>
      ))}

      {clip ? (
        <TouchableOpacity
          style={[styles.button, busy && styles.disabled]}
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
