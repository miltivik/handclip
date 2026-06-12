import { View, StyleSheet, Text, useWindowDimensions, GestureResponderEvent } from 'react-native';
import { useState, useRef, useEffect } from 'react';
import TrimHandles from './TrimHandles';

interface TimelineProps {
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  bRollMarkers?: number[];
}

export default function Timeline({
  duration,
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
  bRollMarkers = [],
}: TimelineProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const [zoomLevel, setZoomLevel] = useState(1);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const initialDistance = useRef<number | null>(null);
  const initialZoom = useRef<number>(1);
  const zoomIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: screenWidth } = useWindowDimensions();

  const getDistance = (touches: { pageX: number; pageY: number }[]) => {
    const [t1, t2] = touches;
    return Math.sqrt((t2.pageX - t1.pageX) ** 2 + (t2.pageY - t1.pageY) ** 2);
  };

  const handleTouchStart = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches && touches.length === 2) {
      initialDistance.current = getDistance(touches);
      initialZoom.current = zoomLevel;
    }
  };

  const handleTouchMove = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches && touches.length === 2 && initialDistance.current) {
      const newDistance = getDistance(touches);
      const scale = newDistance / initialDistance.current;
      const newZoom = Math.min(5, Math.max(0.5, initialZoom.current * scale));
      setZoomLevel(newZoom);
      setShowZoomIndicator(true);
      if (zoomIndicatorTimeout.current) clearTimeout(zoomIndicatorTimeout.current);
      zoomIndicatorTimeout.current = setTimeout(() => setShowZoomIndicator(false), 1000);
    }
  };

  const handleTouchEnd = () => {
    initialDistance.current = null;
  };

  useEffect(() => {
    return () => {
      if (zoomIndicatorTimeout.current) clearTimeout(zoomIndicatorTimeout.current);
    };
  }, []);

  const baseTimelineWidth = screenWidth - 40;
  const timelineWidth = baseTimelineWidth * zoomLevel;
  const pixelsPerSecond = timelineWidth / duration;

  const getTickInterval = () => {
    if (zoomLevel > 2) return 5;
    if (zoomLevel > 1) return 10;
    return 30;
  };

  const tickInterval = getTickInterval();
  const numTicks = Math.ceil(duration / tickInterval) + 1;

  return (
    <View style={styles.container} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} accessibilityLabel={`Línea de tiempo, ${formatTime(trimStart)} a ${formatTime(trimEnd)}`}>
      {showZoomIndicator && (
        <View style={styles.zoomIndicator}>
          <Text style={styles.zoomText}>{Math.round(zoomLevel * 100)}%</Text>
        </View>
      )}
      <View style={[styles.timelineTrack, { width: timelineWidth }]}>
        {Array.from({ length: numTicks }, (_, i) => {
          const tickTime = i * tickInterval;
          const tickPosition = tickTime * pixelsPerSecond;
          return (
            <View key={`tick-${i}`} style={[styles.tick, { left: tickPosition }]}>
              <Text style={styles.tickText}>{formatTime(tickTime)}</Text>
            </View>
          );
        })}
        {bRollMarkers.map((marker, i) => (
          <View
            key={`broll-${i}`}
            style={[styles.bRollMarker, { left: marker * pixelsPerSecond }]}
          />
        ))}
        <TrimHandles
          trimStart={trimStart}
          trimEnd={trimEnd}
          pixelsPerSecond={pixelsPerSecond}
          onTrimStartChange={onTrimStartChange}
          onTrimEndChange={onTrimEndChange}
          duration={duration}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  zoomIndicator: {
    position: 'absolute',
    top: -24,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    zIndex: 10,
  },
  zoomText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  timelineTrack: {
    height: 60,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  tick: {
    position: 'absolute',
    top: 4,
  },
  tickText: {
    fontSize: 10,
    color: '#666',
    marginLeft: -12,
  },
  bRollMarker: {
    position: 'absolute',
    top: 20,
    width: 2,
    height: 20,
    backgroundColor: '#0055ff',
  },
});
