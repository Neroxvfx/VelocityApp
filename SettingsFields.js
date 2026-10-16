import React from 'react';
import { Text, View, TouchableOpacity, TextInput } from 'react-native';
import styles from './styles';
import { FPS_BUTTONS, RES_PRESETS } from './helpers';

export default function SettingsFields({ fps, w, h, onFps, onW, onH }) {
  return (
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
}
