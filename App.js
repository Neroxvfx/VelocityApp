import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  BackHandler,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { Video, ResizeMode } from 'expo-av';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';
import styles from './styles';
import {
  BASE,
  toPath,
  checkSettings,
  defaultSegs,
  loadProjects,
  saveProject,
} from './helpers';
import SettingsFields from './SettingsFields';
import AudioSection from './AudioSection';
import { HomeScreen, NewProjectScreen } from './Screens';

export default function App() {
  const [screen, setScreen] = useState('home');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const dirty = useRef(false);

  const [newName, setNewName] = useState('');
  const [newFps, setNewFps] = useState('30');
  const [newW, setNewW] = useState('1080');
  const [newH, setNewH] = useState('1920');

  const [resultUri, setResultUri] = useState(null);
  const [resultKey, setResultKey] = useState(0);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addLog = (line) => setLog((old) => [...old, line]);

  useEffect(() => {
    loadProjects().then(setProjects);
  }, []);

  // Auto-save the project a moment after any change
  useEffect(() => {
    if (!project || !dirty.current) return;
    const t = setTimeout(() => {
      saveProject(project).catch(() => {});
      dirty.current = false;
    }, 600);
    return () => clearTimeout(t);
  }, [project]);

  const change = (fn) => {
    dirty.current = true;
    setProject((old) => fn(old));
  };

  const resetResult = () => {
    setResultUri(null);
    setLog([]);
    setSaved(false);
  };

  const goHome = async () => {
    if (busy || copying) {
      Alert.alert('Please wait', 'Wait until the work is finished.');
      return;
    }
    if (project && dirty.current) {
      try {
        await saveProject(project);
      } catch (e) {}
      dirty.current = false;
    }
    setProject(null);
    setActiveId(null);
    resetResult();
    setProjects(await loadProjects());
    setScreen('home');
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'project') {
        goHome();
        return true;
      }
      if (screen === 'new') {
        setScreen('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, project, busy, copying]);

  const openProject = (p) => {
    dirty.current = false;
    setProject(p);
    setActiveId(null);
    resetResult();
    setScreen('project');
  };

  const createProject = async () => {
    const s = checkSettings(newFps, newW, newH);
    if (s.error) {
      Alert.alert('Check settings', s.error);
      return;
    }
    const p = {
      id: 'p' + Date.now(),
      name: newName.trim() || 'Untitled',
      fps: newFps.trim(),
      width: String(s.w),
      height: String(s.h),
      clips: [],
      audios: [],
      created: Date.now(),
    };
    try {
      await saveProject(p);
    } catch (e) {
      Alert.alert('Could not create project', String(e));
      return;
    }
    setNewName('');
    openProject(p);
  };

  const deleteProject = (p) => {
    Alert.alert('Delete project?', '"' + p.name + '" and its clips will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await FileSystem.deleteAsync(BASE + p.id + '/', { idempotent: true });
          } catch (e) {}
          setProjects(await loadProjects());
        },
      },
    ]);
  };

  const clips = project ? project.clips : [];
  const clip = clips.find((c) => c.id === activeId) || clips[0] || null;
  const clipUri = clip ? BASE + project.id + '/' + clip.file : null;
  const segs = clip ? clip.segs : [];
  const mode = clip ? clip.mode : 'off';

  const changeClip = (fn) => {
    const id = clip.id;
    change((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === id ? fn(c) : c)),
    }));
  };

  const selectClip = (id) => {
    if (busy || copying) return;
    setActiveId(id);
    resetResult();
  };

  const addClip = async () => {
    if (copying || busy || !project) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setCopying(true);
      const stamp = Date.now();
      const file = 'clip_' + stamp + '.mp4';
      await FileSystem.copyAsync({
        from: asset.uri,
        to: BASE + project.id + '/' + file,
      });
      const len = asset.duration ? asset.duration / 1000 : 0;
      const newClip = {
        id: 'c' + stamp,
        file: file,
        width: asset.width,
        height: asset.height,
        duration: len,
        size: asset.fileSize || 0,
        segs: defaultSegs(len),
        mode: 'off',
      };
      change((p) => ({ ...p, clips: [...p.clips, newClip] }));
      setActiveId(newClip.id);
      resetResult();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
    setCopying(false);
  };

  const removeClip = (c) => {
    if (busy || copying) return;
    Alert.alert('Remove clip?', 'This clip and its remap parts will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await FileSystem.deleteAsync(BASE + project.id + '/' + c.file, { idempotent: true });
          } catch (e) {}
          change((p) => ({ ...p, clips: p.clips.filter((x) => x.id !== c.id) }));
          if (clip && clip.id === c.id) setActiveId(null);
          resetResult();
        },
      },
    ]);
  };

  const updateSeg = (i, field, value) => {
    changeClip((c) => ({
      ...c,
      segs: c.segs.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    }));
  };

  const addSeg = () => {
    const len = clip && clip.duration ? clip.duration : 5;
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

  const setField = (field, value) => {
    change((p) => ({ ...p, [field]: value }));
  };

  const seconds = clip && clip.duration ? clip.duration.toFixed(1) : '?';
  const mb = clip && clip.size ? (clip.size / 1048576).toFixed(1) : '?';

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
    if (!project || !clip || busy || copying) return;

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
      if (dirty.current) {
        await saveProject(project);
        dirty.current = false;
      }
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

  if (screen === 'home') {
    return (
      <HomeScreen
        projects={projects}
        onNew={() => setScreen('new')}
        onOpen={openProject}
        onDelete={deleteProject}
      />
    );
  }

  if (screen === 'new') {
    return (
      <NewProjectScreen
        name={newName}
        setName={setNewName}
        fps={newFps}
        setFps={setNewFps}
        w={newW}
        setW={setNewW}
        h={newH}
        setH={setNewH}
        onBack={() => setScreen('home')}
        onCreate={createProject}
      />
    );
  }

  // ---------- PROJECT SCREEN ----------
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={goHome}>
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.projTitle} numberOfLines={1}>
          {project ? project.name : ''}
        </Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Project settings</Text>
        {project ? (
          <SettingsFields
            fps={project.fps}
            w={project.width}
            h={project.height}
            onFps={(v) => setField('fps', v)}
            onW={(v) => setField('width', v)}
            onH={(v) => setField('height', v)}
          />
        ) : null}

        <Text style={styles.label}>Clips</Text>
        {clips.length === 0 ? <Text style={styles.line}>No clips yet.</Text> : null}
        {clips.map((c, i) => (
          <View
            key={c.id}
            style={[
              styles.card,
              clip && c.id === clip.id && { borderWidth: 2, borderColor: '#3b82f6' },
            ]}
          >
            <TouchableOpacity style={{ flex: 1 }} onPress={() => selectClip(c.id)}>
              <Text style={styles.cardName}>Clip {i + 1}</Text>
              <Text style={styles.cardInfo}>
                {c.width} x {c.height}, {(c.duration || 0).toFixed(1)} s
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.xcell} onPress={() => removeClip(c)}>
              <Text style={styles.xText}>X</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.button, (copying || busy) && styles.disabled]}
          onPress={addClip}
        >
          <Text style={styles.buttonText}>{copying ? 'Copying clip...' : '+ Add clip'}</Text>
        </TouchableOpacity>

        {clip ? (
          <View>
            <Text style={[styles.line, { marginTop: 12 }]}>
              {mb} MB, {clip.width} x {clip.height}, {seconds} seconds
            </Text>
            <Text style={styles.label}>Original</Text>
            <Video
              key={clip.id}
              style={styles.player}
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
          </View>
        ) : null}

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

        {project ? (
          <AudioSection
            project={project}
            clip={clip}
            clipUri={clipUri}
            change={change}
            busy={busy || copying}
            setBusy={setBusy}
          />
        ) : null}

        <View style={{ height: 80 }} />
      </ScrollView>

      <StatusBar style="light" />
    </View>
  );
}
