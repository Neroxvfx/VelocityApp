import React, { useState, useEffect, useRef } from 'react';
import { Text, View, TouchableOpacity, TextInput, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import styles from './styles';
import {
  BASE,
  snapFrame,
  updateAudio,
  addBeat,
  removeBeatIndex,
  clearBeats,
} from './helpers';
import { makeWave, makeSpeedCopy } from './audioTools';

const SPEED_CHIPS = ['0.5', '1.5', '2'];

export default function AudioPanel({
  project,
  audio,
  index,
  change,
  busy,
  setBusy,
  playhead,
  setPlayhead,
  fps,
  onRemoved,
}) {
  const [playing, setPlaying] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [speedText, setSpeedText] = useState('1.5');
  const [pitchMode, setPitchMode] = useState('keep');
  const [message, setMessage] = useState('');
  const soundRef = useRef(null);

  const start = audio.start || 0;
  const dur = audio.duration || 0;
  const beats = audio.beats || [];

  const stopSound = async () => {
    const s = soundRef.current;
    soundRef.current = null;
    setPlaying(false);
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

  const togglePlay = async () => {
    if (playing) {
      await stopSound();
      return;
    }
    await stopSound();
    try {
      const inside = playhead >= start && playhead < start + dur;
      const startPos = inside ? playhead - start : 0;
      const created = await Audio.Sound.createAsync(
        { uri: BASE + project.id + '/' + audio.file },
        {
          shouldPlay: true,
          positionMillis: Math.round(startPos * 1000),
          progressUpdateIntervalMillis: 100,
        }
      );
      soundRef.current = created.sound;
      setPlaying(true);
      created.sound.setOnPlaybackStatusUpdate((st) => {
        if (st && st.isLoaded) {
          setPlayhead(start + (st.positionMillis || 0) / 1000);
          if (st.didJustFinish) {
            stopSound();
          }
        }
      });
    } catch (e) {
      Alert.alert('Could not play', String(e));
    }
  };

  const markBeat = async () => {
    let tl;
    const s = soundRef.current;
    if (s && playing) {
      try {
        const st = await s.getStatusAsync();
        if (st.isLoaded) tl = start + (st.positionMillis || 0) / 1000;
      } catch (e) {}
    }
    if (tl === undefined) tl = playhead;
    const ta = tl - start;
    if (ta < 0 || ta > dur) {
      Alert.alert('Outside the audio', 'Move the playhead onto this audio layer first.');
      return;
    }
    addBeat(change, audio.id, snapFrame(ta, fps));
  };

  const removeNearest = () => {
    const ta = playhead - start;
    let idx = -1;
    let nd = 1e9;
    beats.forEach((b, i) => {
      const d = Math.abs(b - ta);
      if (d < nd) {
        nd = d;
        idx = i;
      }
    });
    if (idx < 0 || nd > 1) {
      Alert.alert('No beat here', 'Move the playhead closer to a beat first.');
      return;
    }
    removeBeatIndex(change, audio.id, idx);
  };

  const clearAll = () => {
    Alert.alert('Clear beats?', 'All beat markers on this layer will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearBeats(change, audio.id) },
    ]);
  };

  const drawWave = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('Drawing waveform...');
    const w = await makeWave(project, audio);
    if (w) {
      updateAudio(change, audio.id, (x) => ({ ...x, ...w }));
      setMessage('');
    } else {
      setMessage('Could not draw the waveform.');
    }
    setBusy(false);
  };

  const createSpeedCopy = async () => {
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
      const item = await makeSpeedCopy(project, audio, sp, pitchMode);
      change((p) => ({ ...p, audios: [...(p.audios || []), item] }));
      setSpeedOpen(false);
      setMessage('Done. New audio layer added: ' + item.name);
    } catch (e) {
      setMessage(String(e.message || e));
    }
    setBusy(false);
  };

  const removeAudio = () => {
    if (busy) return;
    Alert.alert('Remove layer?', '"' + audio.name + '" will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await stopSound();
          try {
            await FileSystem.deleteAsync(BASE + project.id + '/' + audio.file, { idempotent: true });
          } catch (e) {}
          if (audio.wave) {
            try {
              await FileSystem.deleteAsync(BASE + project.id + '/' + audio.wave, { idempotent: true });
            } catch (e) {}
          }
          change((p) => ({ ...p, audios: (p.audios || []).filter((x) => x.id !== audio.id) }));
          onRemoved();
        },
      },
    ]);
  };

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.label}>Audio {index + 1}</Text>
      <Text style={styles.line} numberOfLines={1}>
        {audio.name}
      </Text>
      <Text style={styles.cardInfo}>
        {dur.toFixed(1)} s{beats.length > 0 ? ', ' + beats.length + ' beats' : ''}
      </Text>

      <View style={[styles.chipRow, { marginTop: 10 }]}>
        <TouchableOpacity
          style={[styles.chip, playing && styles.modeActive]}
          onPress={togglePlay}
        >
          <Text style={styles.chipText}>{playing ? 'Stop' : 'Play'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.chip, { backgroundColor: '#ca8a04' }]} onPress={markBeat}>
          <Text style={styles.chipText}>Mark beat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.chip} onPress={removeNearest}>
          <Text style={styles.chipText}>Remove beat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.chip} onPress={clearAll}>
          <Text style={styles.chipText}>Clear beats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, speedOpen && styles.modeActive]}
          onPress={() => setSpeedOpen(!speedOpen)}
        >
          <Text style={styles.chipText}>Speed</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>
        Tap this layer's waveform in the timeline to add or remove a beat. Play starts at the
        playhead. Mark beat drops a beat at the playing position, or at the playhead.
      </Text>

      {!audio.wave ? (
        <TouchableOpacity style={[styles.addBtn, busy && styles.disabled]} onPress={drawWave}>
          <Text style={styles.buttonText}>Draw waveform</Text>
        </TouchableOpacity>
      ) : null}

      {speedOpen ? (
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
            onPress={createSpeedCopy}
          >
            <Text style={styles.buttonText}>Create new audio layer</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {message ? <Text style={styles.logLine}>{message}</Text> : null}

      <TouchableOpacity style={[styles.addBtn, { marginTop: 14 }]} onPress={removeAudio}>
        <Text style={[styles.buttonText, { color: '#f87171' }]}>Remove this layer</Text>
      </TouchableOpacity>
    </View>
  );
}
