import React from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import styles from './styles';
import { fmtTimecode } from './helpers';

export default function TimeBar({ playhead, fps, onJump, onStep, onZoom }) {
  const btn = (label, onPress, key) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, { marginBottom: 0, paddingHorizontal: 16, paddingVertical: 10 }]}
      onPress={onPress}
    >
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={{ marginTop: 12, marginBottom: 8 }}>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold' }}>
        {fmtTimecode(playhead, fps)}
      </Text>
      <Text style={styles.hint}>
        frame {Math.round(playhead * fps)} | {fps} fps
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {btn('|<', () => onJump(-1), 'jp')}
        {btn('<', () => onStep(-1), 'sp')}
        {btn('>', () => onStep(1), 'sn')}
        {btn('>|', () => onJump(1), 'jn')}
        {btn('-', () => onZoom(-1), 'zo')}
        {btn('+', () => onZoom(1), 'zi')}
      </View>
      <Text style={styles.hint}>
        |< and >| jump to keyframes, or beats and clip edges. < and > step one frame. - and + zoom.
      </Text>
    </View>
  );
}
