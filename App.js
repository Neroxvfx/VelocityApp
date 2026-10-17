import React, { useState, useEffect, useRef } from 'react';
import { Alert, BackHandler } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { BASE, checkSettings, loadProjects, saveProject } from './helpers';
import { HomeScreen, NewProjectScreen } from './Screens';
import ProjectScreen from './ProjectScreen';

export default function App() {
  const [screen, setScreen] = useState('home');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);

  const [newName, setNewName] = useState('');
  const [newFps, setNewFps] = useState('30');
  const [newW, setNewW] = useState('1080');
  const [newH, setNewH] = useState('1920');

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

  const setField = (field, value) => {
    change((p) => ({ ...p, [field]: value }));
  };

  const goHome = async () => {
    if (busy) {
      Alert.alert('Please wait', 'Wait until the work is finished.');
      return;
    }
    if (project && dirty.current) {
      try {
        await saveProject(project);
      } catch (e) {}
      dirty.current = false;
    }
    setScreen('home');
    setProject(null);
    setProjects(await loadProjects());
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
  }, [screen, project, busy]);

  const openProject = (p) => {
    dirty.current = false;
    setProject(p);
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

  if (!project) return null;

  return (
    <ProjectScreen
      key={project.id}
      project={project}
      change={change}
      setField={setField}
      busy={busy}
      setBusy={setBusy}
      goHome={goHome}
    />
  );
}
