import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { FFmpegKit, FFprobeKit, ReturnCode } from 'ffmpeg-kit-react-native';

export default function App() {
  const [video, setVideo] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

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
        setVideo(result.assets[0]);
        setLog([]);
      }
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const seconds = video && video.duration ? (video.duration / 1000).toFixed(1) : '?';
  const mb = video && video.fileSize ? (video.fileSize / 1048576).toFixed(1) : '?';

  const testFFmpeg = async () => {
    if (!video || busy) return;
    setBusy(true);
    setLog([]);
    try {
      addLog('1) Checking FFmpeg version...');
      const v = await FFmpegKit.execute('-version');
      const vOut = await v.getOutput();
      addLog('OK: ' + String(vOut).split('\n')[0]);

      const input = toPath(video.uri);
      const output = input.replace(/[^/]+$/, 'velocity_test_2x.mp4');

      addLog('2) Making a 2x faster copy...');
      const cmd =
        '-y -i "' + input + '" -vf "setpts=0.5*PTS" -an -c:v libx264 -preset ultrafast "' + output + '"';
      const s = await FFmpegKit.execute(cmd);
      const rc = await s.getReturnCode();
      if (!ReturnCode.isSuccess(rc)) {
        const logs = await s.getAllLogsAsString();
        addLog('FAILED. Last part of the log:');
        addLog(String(logs).slice(-700));
        setBusy(false);
        return;
      }
      addLog('Done encoding.');

      addLog('3) Checking the new video...');
      const probe = await FFprobeKit.getMediaInformation(output);
      const info = await probe.getMediaInformation();
      const dur = info.getDuration();
      addLog('New length: ' + dur + ' seconds (original: ' + seconds + ')');
      addLog('If the new length is about half of the original, FFmpeg works!');
    } catch (e) {
      addLog('Error: ' + String(e));
    }
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Velocity</Text>

      <TouchableOpacity style={styles.button} onPress={pickVideo}>
        <Text style={styles.buttonText}>Pick a video</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.second, (!video || busy) && styles.disabled]}
        onPress={testFFmpeg}
      >
        <Text style={styles.buttonText}>{busy ? 'Working...' : 'Test FFmpeg'}</Text>
      </TouchableOpacity>

      <ScrollView style={styles.info}>
        {video ? (
          <View>
            <Text style={styles.line}>Name: {video.fileName || 'unknown'}</Text>
            <Text style={styles.line}>Size: {mb} MB</Text>
            <Text style={styles.line}>
              Resolution: {video.width} x {video.height}
            </Text>
            <Text style={styles.line}>Length: {seconds} seconds</Text>
          </View>
        ) : (
          <Text style={styles.line}>No video picked yet.</Text>
        )}

        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
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
  second: {
    marginTop: 12,
    backgroundColor: '#22c55e',
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
  logLine: {
    color: '#facc15',
    fontSize: 14,
    marginBottom: 8,
  },
});
