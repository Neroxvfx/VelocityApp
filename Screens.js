import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, View, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import styles from './styles';
import SettingsFields from './SettingsFields';

export function HomeScreen({ projects, onNew, onOpen, onDelete }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Velocity</Text>
      <TouchableOpacity style={styles.button} onPress={onNew}>
        <Text style={styles.buttonText}>New project</Text>
      </TouchableOpacity>

      <ScrollView style={styles.info}>
        <Text style={styles.label}>Your projects</Text>
        {projects.length === 0 ? <Text style={styles.line}>No projects yet.</Text> : null}
        {projects.map((p) => (
          <View key={p.id} style={styles.card}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => onOpen(p)}>
              <Text style={styles.cardName}>{p.name}</Text>
              <Text style={styles.cardInfo}>
                {p.fps} fps, {p.width} x {p.height},{' '}
                {p.clips.length === 0
                  ? 'no clips yet'
                  : p.clips.length + (p.clips.length === 1 ? ' clip' : ' clips')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.xcell} onPress={() => onDelete(p)}>
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

export function NewProjectScreen(props) {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={props.onBack}>
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.projTitle}>New project</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.inputFull}
          value={props.name}
          placeholder="My edit"
          placeholderTextColor="#666"
          onChangeText={props.setName}
        />

        <SettingsFields
          fps={props.fps}
          w={props.w}
          h={props.h}
          onFps={props.setFps}
          onW={props.setW}
          onH={props.setH}
        />

        <TouchableOpacity style={[styles.button, styles.apply]} onPress={props.onCreate}>
          <Text style={styles.buttonText}>Create project</Text>
        </TouchableOpacity>
        <View style={{ height: 80 }} />
      </ScrollView>
      <StatusBar style="light" />
    </View>
  );
}
