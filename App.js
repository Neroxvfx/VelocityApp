import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
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

const BASE = FileSystem.documentDirectory + 'velocity/projects/';
const FPS_BUTTONS = ['24', '25', '30', '60'];
const RES_PRESETS = [
  { label: '1080x1920', w: '1080', h: '1920' },
  { label: '720x1280', w: '720', h: '1280' },
  { label: '1080x1080', w: '1080', h: '1080' },
  { label: '1920x1080', w: '1920', h: '1080' },
];

const toPath = (uri) => uri.replace('file://', '');

function checkSettings(fpsText, wText, hText) {
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

async function loadProjects() {
  try {
    const info = await FileSystem.getInfoAsync(BASE);
    if (!info.exists) return [];
    const names = await FileSystem.readDirectoryAsync(BASE);
    const list = [];
    for (let i = 0; i < names.length; i++) {
      try {
        const txt = await FileSystem.readAsStringAsync(BASE + names[i] + '/project.json');
        list.push(JSON.parse(txt));
      } catch (e) {}
    }
    list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return list;
  } catch (e) {
    return [];
  }
}

async function saveProject(p) {
  await FileSystem.makeDirectoryAsync(BASE + p.id + '/', { intermediates: true });
  const data = { ...p, updated: Date.now() };
  await FileSystem.writeAsStringAsync(BASE + p.id + '/project.json', JSON.stringify(data));
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
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
    setResultUri(null);
    setLog([]);
    setSaved(false);
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
    setResultUri(null);
    setLog([]);
    setSaved(false);
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
      segs: [],
      mode: 'off',
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

  const clip = project && project.clips && project.clips.length > 0 ? project.clips[0] : null;
  const clipUri = clip ? BASE + project.id + '/' + clip.file : null;
  const segs = project ? project.segs : [];
  const mode = project ? project.mode : 'off';

  const pickVideo = async () => {
    if (copying || busy) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setCopying(true);
      const file = 'clip_' + Date.now() + '.mp4';
      await FileSystem.copyAsync({
        from: asset.uri,
        to: BASE + project.id + '/' + file,
      });
      if (clip) {
        try {
          await FileSystem.deleteAsync(BASE + project.id + '/' + clip.file, { idempotent: true });
        } catch (e) {}
      }
      const len = asset.duration ? asset.duration / 1000 : 0;
      let newSegs;
      if (len > 0) {
        const third = len / 3;
        newSegs = [
          { start: '0', end: third.toFixed(2), speed: '1' },
          { start: third.toFixed(2), end: (third * 2).toFixed(2), speed: '0.25' },
          { start: (third * 2).toFixed(2), end: len.toFixed(2), speed: '2' },
        ];
      } else {
        newSegs = [{ start: '0', end: '5', speed: '1' }];
      }
      change((p) => ({
        ...p,
        clips: [
          {
            file: file,
            width: asset.width,
            height: asset.height,
            duration: len,
            size: asset.fileSize || 0,
          },
        ],
        segs: newSegs,
      }));
      setResultUri(null);
      setSaved(false);
      setLog([]);
    } catch (e) {
      Alert.alert('Error', String(e));
    }
    setCopying(false);
  };

  const updateSeg = (i, field, value) => {
    change((p) => ({
      ...p,
      segs: p.segs.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    }));
  };

  const addSeg = () => {
    const len = clip && clip.duration ? clip.duration : 5;
    const last = segs.length > 0 ? segs[segs.length - 1].end : '0';
    change((p) => ({
      ...p,
      segs: [...p.segs, { start: String(last), end: len.toFixed(2), speed: '1' }],
    }));
  };

  const removeSeg = (i) => {
    change((p) => ({ ...p, segs: p.segs.filter((s, idx) => idx !== i) }));
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

      addLog(
        'Project: ' + fps + ' fps, ' + W + ' x ' + H + '. Smoothing: ' + mode
      );

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
      onPress={() => setField('mode', key)}
    >
      <Text style={styles.modeText}>{label}</Text>
    </TouchableOpacity>
  );

  const settingsFields = (fps, w, h, onFps, onW, onH) => (
    <View>
      <Text style={styles.label}>Frame rate (1 to 120)</Text>
      <TextInput
        style={styles.inputFull}
        value={fps}
        keyboardType="decimal-pad"
        onChangeText={onFps}
      />
      <View style={styles.chipRow}>
        {FPS_BUTTONS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, fps === f && styles.modeActive]}
            onPress={() => onFps(f)}
          >
            <Text style={styles.chipText}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>
        Decimals work, like 23.976. Standard rates are safest for Alight Motion.
      </Text>

      <Text style={styles.label}>Resolution (width x height)</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.cell]}
          value={w}
          keyboardType="number-pad"
          onChangeText={onW}
        />
        <Text style={styles.xSign}>x</Text>
        <TextInput
          style={[styles.input, styles.cell]}
          value={h}
          keyboardType="number-pad"
          onChangeText={onH}
        />
      </View>
      <View style={styles.chipRow}>
        {RES_PRESETS.map((r) => (
          <TouchableOpacity
            key={r.label}
            style={[styles.chip, w === r.w && h === r.h && styles.modeActive]}
            onPress={() => {
              onW(r.w);
              onH(r.h);
            }}
          >
            <Text style={styles.chipText}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // ---------- HOME SCREEN ----------
  if (screen === 'home') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Velocity</Text>
        <TouchableOpacity style={styles.button} onPress={() => setScreen('new')}>
          <Text style={styles.buttonText}>New project</Text>
        </TouchableOpacity>

        <ScrollView style={styles.info}>
          <Text style={styles.label}>Your projects</Text>
          {projects.length === 0 ? (
            <Text style={styles.line}>No projects yet.</Text>
          ) : null}
          {projects.map((p) => (
            <View key={p.id} style={styles.card}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => openProject(p)}>
                <Text style={styles.cardName}>{p.name}</Text>
                <Text style={styles.cardInfo}>
                  {p.fps} fps, {p.width} x {p.height},{' '}
                  {p.clips && p.clips.length > 0 ? p.clips.length + ' clip' : 'no clip yet'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.xcell} onPress={() => deleteProject(p)}>
                <Text style={styles.xText}>X</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ height: 80 }} />
        </ScrollView>
        <StatusBar style="light" />
      </View>
    );
  }

  // ---------- NEW PROJECT SCREEN ----------
  if (screen === 'new') {
    return (
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')}>
            <Text style={styles.buttonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.projTitle}>New project</Text>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.inputFull}
            value={newName}
            placeholder="My edit"
            placeholderTextColor="#666"
            onChangeText={setNewName}
          />

          {settingsFields(newFps, newW, newH, setNewFps, setNewW, setNewH)}

          <TouchableOpacity style={[styles.button, styles.apply]} onPress={createProject}>
            <Text style={styles.buttonText}>Create project</Text>
          </TouchableOpacity>
          <View style={{ height: 80 }} />
        </ScrollView>
        <StatusBar style="light" />
      </View>
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
        {project
          ? settingsFields(
              project.fps,
              project.width,
              project.height,
              (v) => setField('fps', v),
              (v) => setField('width', v),
              (v) => setField('height', v)
            )
          : null}

        <TouchableOpacity
          style={[styles.button, (copying || busy) && styles.disabled]}
          onPress={pickVideo}
        >
          <Text style={styles.buttonText}>
            {copying ? 'Copying clip...' : clip ? 'Replace clip' : 'Pick a video'}
          </Text>
        </TouchableOpacity>

        {clip ? (
          <View>
            <Text style={[styles.line, { marginTop: 12 }]}>
              {mb} MB, {clip.width} x {clip.height}, {seconds} seconds
            </Text>
            <Text style={styles.label}>Original</Text>
            <Video
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
              <Text style={styles.buttonText}>+ Add part</
