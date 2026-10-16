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

export default function App() {
  const [video, setVideo] = useState(null);

  const pickVideo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });
      if (!result.canceled) {
        setVideo(result.assets[0]);
      }
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const seconds = video && video.duration ? (video.duration / 1000).toFixed(1) : '?';
  const mb = video && video.fileSize ? (video.fileSize / 1048576).toFixed(1) : '?';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Velocity</Text>

      <TouchableOpacity style={styles.button} onPress={pickVideo}>
        <Text style={styles.buttonText}>Pick a video</Text>
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
            <Text style={styles.line}>Path: {video.uri}</Text>
          </View>
        ) : (
          <Text style={styles.line}>No video picked yet.</Text>
        )}
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
});
