import React, { useState, useEffect, useRef } from 'react';
import { Text, View, ScrollView, TouchableOpacity, Pressable, Image } from 'react-native';
import { BASE, remapLength, snapFrame, pad2, timelineSeconds } from './helpers';

const LABEL_W = 64;
const RULER_H = 34;
const ROW_H = 48;

const Ruler = React.memo(function Ruler({ pps, fps, totalSeconds, from, to }) {
  const fpsN = Math.max(1, Math.round(fps));
  const items = [];
  const tick = (key, x, h, color) => (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: x,
        top: RULER_H - h,
        width: 1,
        height: h,
        backgroundColor: color,
      }}
    />
  );
  const label = (key, x, text) => (
    <Text
      key={key}
      style={{ position: 'absolute', left: x + 3, top: 2, color: '#aaa', fontSize: 10 }}
    >
      {text}
    </Text>
  );

  if (pps / fps >= 8) {
    // zoomed in: a tick for every frame
    const cands = [1, 2, 5, 10, fpsN, fpsN * 2, fpsN * 5];
    let labelStep = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) {
      if ((cands[i] / fps) * pps >= 56) {
        labelStep = cands[i];
        break;
      }
    }
    const f0 = Math.max(0, Math.floor((from / pps) * fps));
    const f1 = Math.min(Math.ceil(totalSeconds * fps), Math.ceil((to / pps) * fps));
    for (let f = f0; f <= f1; f++) {
      const x = (f / fps) * pps;
      const major = f % labelStep === 0;
      items.push(tick('t' + f, x, major ? 16 : 6, major ? '#999' : '#555'));
      if (major) {
        const sec = Math.floor(f / fpsN);
        const ff = f % fpsN;
        items.push(label('l' + f, x, sec + 's' + (ff ? pad2(ff) + 'f' : '')));
      }
    }
  } else {
    // zoomed out: seconds
    const cands = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    let step = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) {
      if (cands[i] * pps >= 56) {
        step = cands[i];
        break;
      }
    }
    const i0 = Math.max(0, Math.floor(from / pps / step));
    const i1 = Math.min(Math.ceil(totalSeconds / step), Math.ceil(to / pps / step));
    for (let i = i0; i <= i1; i++) {
      const t = i * step;
      const x = t * pps;
      items.push(tick('t' + i, x, 16, '#999'));
      const whole = Math.floor(t + 0.001);
      const text =
        Math.floor(whole / 60) + ':' + pad2(whole % 60) + (t - whole > 0.01 ? '.5' : '');
      items.push(label('l' + i, x, text));
      if (step >= 1 && (step * pps) / 5 >= 8) {
        for (let k = 1; k < 5; k++) {
          items.push(tick('m' + i + '_' + k, x + (k * step * pps) / 5, 6, '#555'));
        }
      }
    }
  }

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: Math.round(totalSeconds * pps),
        height: RULER_H,
      }}
    >
      {items}
    </View>
  );
});

export default function Timeline({
  project,
  fps,
  selected,
  onSelect,
  playhead,
  onSeek,
  pps,
  onAudioTap,
}) {
  const hRef = useRef(null);
  const scrollX = useRef(0);
  const prevPps = useRef(pps);
  const [viewW, setViewW] = useState(300);
  const [bucket, setBucket] = useState(0);
  const [scrollOn, setScrollOn] = useState(true);

  const clips = project.clips || [];
  const audios = project.audios || [];
  const totalSeconds = timelineSeconds(project);
  const totalW = Math.round(totalSeconds * pps);

  const rows = [];
  for (let i = clips.length - 1; i >= 0; i--) {
    rows.push({
      type: 'clip',
      id: clips[i].id,
      label: 'Clip ' + (i + 1),
      layer: clips[i],
      len: remapLength(clips[i]),
    });
  }
  for (let i = audios.length - 1; i >= 0; i--) {
    rows.push({
      type: 'audio',
      id: audios[i].id,
      label: 'Audio ' + (i + 1),
      layer: audios[i],
      len: audios[i].duration || 0,
    });
  }

  // keep the playhead in the same screen spot when zooming
  useEffect(() => {
    if (prevPps.current !== pps && hRef.current) {
      const screenX = playhead * prevPps.current - scrollX.current;
      const keep = Math.min(Math.max(screenX, 0), viewW);
      const nx = Math.max(0, playhead * pps - keep);
      hRef.current.scrollTo({ x: nx, animated: false });
      scrollX.current = nx;
    }
    prevPps.current = pps;
  }, [pps]);

  // scroll so the playhead stays visible
  useEffect(() => {
    const x = playhead * pps;
    const sx = scrollX.current;
    if (hRef.current && viewW > 0 && (x < sx + 10 || x > sx + viewW - 10)) {
      hRef.current.scrollTo({ x: Math.max(0, x - viewW / 2), animated: false });
    }
  }, [playhead]);

  const onScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    scrollX.current = x;
    const b = Math.floor(x / 300);
    if (b !== bucket) setBucket(b);
  };

  const seekFromX = (x) => {
    const t = Math.min(totalSeconds, Math.max(0, x / pps));
    onSeek(snapFrame(t, fps));
  };

  const from = Math.max(0, bucket * 300 - 300);
  const to = bucket * 300 + viewW + 600;
  const bodyH = RULER_H + Math.max(1, rows.length) * ROW_H;

  return (
    <View style={{ flexDirection: 'row', backgroundColor: '#141414', borderRadius: 8 }}>
      <View style={{ width: LABEL_W }}>
        <View style={{ height: RULER_H, backgroundColor: '#222' }} />
        {rows.map((r, idx) => {
          const sel = selected && selected.type === r.type && selected.id === r.id;
          return (
            <TouchableOpacity
              key={r.type + r.id}
              style={{
                height: ROW_H,
                justifyContent: 'center',
                paddingHorizontal: 6,
                backgroundColor: idx % 2 === 0 ? '#171717' : '#1c1c1c',
              }}
              onPress={() => onSelect({ type: r.type, id: r.id })}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: sel ? '#60a5fa' : '#ccc',
                  fontSize: 12,
                  fontWeight: sel ? 'bold' : 'normal',
                }}
              >
                {r.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        {rows.length === 0 ? <View style={{ height: ROW_H }} /> : null}
      </View>

      <ScrollView
        ref={hRef}
        horizontal
        style={{ flex: 1 }}
        scrollEnabled={scrollOn}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onLayout={(e) => setViewW(e.nativeEvent.layout.width)}
      >
        <View style={{ width: totalW, height: bodyH }}>
          <View
            style={{ height: RULER_H, width: totalW, backgroundColor: '#222' }}
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={(e) => {
              setScrollOn(false);
              seekFromX(e.nativeEvent.locationX);
            }}
            onResponderMove={(e) => seekFromX(e.nativeEvent.locationX)}
            onResponderRelease={() => setScrollOn(true)}
            onResponderTerminate={() => setScrollOn(true)}
          >
            <Ruler pps={pps} fps={fps} totalSeconds={totalSeconds} from={from} to={to} />
          </View>

          {rows.length === 0 ? (
            <View style={{ height: ROW_H, justifyContent: 'center', paddingLeft: 10 }}>
              <Text style={{ color: '#777', fontSize: 13 }}>
                Import a video or audio to start.
              </Text>
            </View>
          ) : null}

          {rows.map((r, idx) => {
            const sel = selected && selected.type === r.type && selected.id === r.id;
            const left = (r.layer.start || 0) * pps;
            const w = Math.max(6, r.len * pps);
            const rowBg = idx % 2 === 0 ? '#171717' : '#1c1c1c';
            const barStyle = {
              position: 'absolute',
              left: left,
              top: 4,
              width: w,
              height: ROW_H - 8,
              borderRadius: 6,
              overflow: 'hidden',
              borderWidth: sel ? 2 : 0,
              borderColor: '#fff',
            };
            return (
              <View
                key={r.type + r.id}
                style={{ height: ROW_H, width: totalW, backgroundColor: rowBg }}
              >
                {r.type === 'clip' ? (
                  <Pressable
                    onPress={() => onSelect({ type: 'clip', id: r.id })}
                    style={[barStyle, { backgroundColor: '#2563eb', justifyContent: 'center' }]}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ color: '#fff', fontSize: 12, marginLeft: 6, fontWeight: 'bold' }}
                    >
                      {r.label + '  ' + r.len.toFixed(1) + 's'}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={(e) => onAudioTap(r.layer, e.nativeEvent.locationX, !!sel)}
                    style={[barStyle, { backgroundColor: '#0b2a4a' }]}
                  >
                    {r.layer.wave ? (
                      <Image
                        pointerEvents="none"
                        source={{ uri: BASE + project.id + '/' + r.layer.wave }}
                        style={{ position: 'absolute', left: 0, top: 0, width: w, height: ROW_H - 8 }}
                        resizeMode="stretch"
                      />
                    ) : (
                      <Text
                        pointerEvents="none"
                        style={{ color: '#7aa', fontSize: 11, marginLeft: 6, marginTop: 10 }}
                      >
                        no waveform yet
                      </Text>
                    )}
                    {(r.layer.beats || []).map((b, i) => (
                      <View
                        key={'b' + i}
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          left: b * pps - 1,
                          top: 0,
                          width: 2,
                          height: ROW_H - 8,
                          backgroundColor: '#facc15',
                        }}
                      />
                    ))}
                  </Pressable>
                )}
              </View>
            );
          })}

          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: Math.max(0, Math.min(totalW - 2, playhead * pps - 1)),
              top: 0,
              width: 2,
              height: bodyH,
              backgroundColor: '#ef4444',
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}
