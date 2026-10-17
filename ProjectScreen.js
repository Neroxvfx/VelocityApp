import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, View, TouchableOpacity, ScrollView, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import styles from './styles';
import {
  BASE,
  defaultSegs,
  jumpTargets,
  nextTarget,
  prevTarget,
  snapFrame,
  timelineSeconds,
  addBeat,
  removeBeatIndex,
} from './helpers';
import { importAudioFile } from './audioTools';
import SettingsFields from './SettingsFields';
import TimeBar from './TimeBar';
import Timeline from './Timeline';
import ClipPanel from './ClipPanel';
import AudioPanel from './AudioPanel';

export default function ProjectScreen({ project, change, setField, busy, setBusy, goHome }) {
  const [selected, setSelected] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [pps, setPps] = useState(40);
  const [showSettings, setShowSettings] = useState(false);
  const [message, setMessage] = useState('');

  const fpsNum = parseFloat(project.fps);
  const fps = isNaN(fpsNum) || fpsNum < 1 ? 30 : fpsNum;
  const clips = project.clips || [];
  const audios = project.audios || [];

  const selClipIdx =
    selected && selected.type === 'clip' ? clips.findIndex((c) => c.id === selected.id) : -1;
  const selAudioIdx =
    selected && selected.type === 'audio' ? audios.findIndex((a) => a.id === selected.id) : -1;

  const onZoom = (dir) => {
    const maxPps = Math.max(10, Math.min(fps * 24, 60000 / timelineSeconds(project)));
    setPps((old) => Math.max(4, Math.min(maxPps, dir > 0 ? old * 1.5 : old / 1.5)));
  };

  const onStep = (dir) => {
    setPlayhead((t) => Math.max(0, (Math.round(t * fps) + dir) / fps));
  };

  const onJump = (dir) => {
    const list = jumpTargets(project, selected, fps);
    const t = dir > 0 ? nextTarget(list, playhead) : prevTarget(list, playhead);
    if (t === null) return;
    setPlayhead(t);
  };

  const importVideo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        setMessage('Copying video...');
        const stamp = Date.now();
        const file = 'clip_' + stamp + '.mp4';
        await FileSystem.copyAsync({
          from: asset.uri,
          to: BASE + project.id + '/' + file,
        });
        const len = asset.duration ? asset.duration / 1000 : 0;
        const c = {
          id: 'c' + stamp,
          file: file,
          width: asset.width,
          height: asset.height,
          duration: len,
          size: asset.fileSize || 0,
          segs: defaultSegs(len),
          mode: 'off',
          start: 0,
        };
        change((p) => ({ ...p, clips: [...p.clips, c] }));
        setSelected({ type: 'clip', id: c.id });
        setMessage('');
      }
    } catch (e) {
      setMessage('');
      Alert.alert('Error', String(e));
    }
    setBusy(false);
  };

  const importAudio = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const item = await importAudioFile(project);
      if (item) {
        setMessage('');
        change((p) => ({ ...p, audios: [...(p.audios || []), item] }));
        setSelected({ type: 'audio', id: item.id });
      }
    } catch (e) {
      Alert.alert('Could not import', String(e.message || e));
    }
    setBusy(false);
  };

  // Tap on an audio bar: select it, or (if already selected) add/remove a beat
  const onAudioTap = (a, x, wasSelected) => {
    if (!wasSelected) {
      setSelected({ type: 'audio', id: a.id });
      return;
    }
    const dur = a.duration || 0;
    if (dur <= 0) return;
    const t = x / pps;
    const beats = a.beats || [];
    let idx = -1;
    let nd = 1e9;
    beats.forEach((b, i) => {
      const d = Math.abs(b - t) * pps;
      if (d < nd) {
        nd = d;
        idx = i;
      }
    });
    if (idx >= 0 && nd < 14) {
      removeBeatIndex(change, a.id, idx);
    } else {
      addBeat(change, a.id, snapFrame(Math.min(dur, Math.max(0, t)), fps));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={goHome}>
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.projTitle} numberOfLines={1}>
          {project.name}
        </Text>
        <TouchableOpacity
          style={[styles.chip, { marginBottom: 0, marginRight: 0 }, showSettings && styles.modeActive]}
          onPress={() => setShowSettings(!showSettings)}
        >
          <Text style={styles.chipText}>Settings</Text>
        </TouchableOpacity>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {showSettings ? (
          <SettingsFields
            fps={project.fps}
            w={project.width}
            h={project.height}
            onFps={(v) => setField('fps', v)}
            onW={(v) => setField('width', v)}
            onH={(v) => setField('height', v)}
          />
        ) : null}

        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity
            style={[styles.button, { flex: 1, padding: 12, marginRight: 8 }, busy && styles.disabled]}
            onPress={importVideo}
          >
            <Text style={styles.buttonText}>Import video</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, { flex: 1, padding: 12 }, busy && styles.disabled]}
            onPress={importAudio}
          >
            <Text style={styles.buttonText}>Import audio</Text>
          </TouchableOpacity>
        </View>
        {busy && message ? <Text style={styles.logLine}>{message}</Text> : null}

        <TimeBar
          playhead={playhead}
          fps={fps}
          onJump={onJump}
          onStep={onStep}
          onZoom={onZoom}
        />

        <Timeline
          project={project}
          fps={fps}
          selected={selected}
          onSelect={setSelected}
          playhead={playhead}
          onSeek={setPlayhead}
          pps={pps}
          onAudioTap={onAudioTap}
        />

        {selClipIdx >= 0 ? (
          <ClipPanel
            key={clips[selClipIdx].id}
            project={project}
            clip={clips[selClipIdx]}
            index={selClipIdx}
            change={change}
            busy={busy}
            setBusy={setBusy}
            onRemoved={() => setSelected(null)}
          />
        ) : null}

        {selAudioIdx >= 0 ? (
          <AudioPanel
            key={audios[selAudioIdx].id}
            project={project}
            audio={audios[selAudioIdx]}
            index={selAudioIdx}
            change={change}
            busy={busy}
            setBusy={setBusy}
            playhead={playhead}
            setPlayhead={setPlayhead}
            fps={fps}
            onRemoved={() => setSelected(null)}
          />
        ) : null}

        {selClipIdx < 0 && selAudioIdx < 0 ? (
          <Text style={[styles.hint, { marginTop: 14 }]}>Tap a layer to edit it.</Text>
        ) : null}

        <View style={{ height: 80 }} />
      </ScrollView>

      <StatusBar style="light" />
    </View>
  );
}
