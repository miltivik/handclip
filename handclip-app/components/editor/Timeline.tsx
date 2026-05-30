import { View, StyleSheet, Text, useWindowDimensions } from 'react-native';
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

  // Pinch-to-zoom state and handlers
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const initialDistance = useRef<number | null>(null);
  const initialZoom = useRef<number>(1);
  const zoomIndicatorTimeout = useRef<NodeJS.Timeout | null>(null);
  const { width: screenWidth } = useWindowDimensions();

  const getDistance = (touches: { pageX: number; pageY: number }[]) => {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: any) => {
    if (e.nativeEvent.touches.length === 2) {
      initialDistance.current = getDistance(e.nativeEvent.touches);
      initialZoom.current = zoomLevel;
    }
  };

  const handleTouchMove = (e: any) => {
    if (e.nativeEvent.touches.length === 2 && initialDistance.current) {
      const currentDistance = getDistance(e.nativeEvent.touches);
      const scale = currentDistance / initialDistance.current;
      const newZoom = Math.min(3, Math.max(0.5, initialZoom.current * scale));
      if (newZoom !== zoomLevel) {
        setZoomLevel(newZoom);
        setShowZoomIndicator(true);
      }
    }
  };

  const handleTouchEnd = () => {
    initialDistance.current = null;
    if (zoomIndicatorTimeout.current) {
      clearTimeout(zoomIndicatorTimeout.current);
    }
    zoomIndicatorTimeout.current = setTimeout(() => {
      setShowZoomIndicator(false);
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (zoomIndicatorTimeout.current) {
        clearTimeout(zoomIndicatorTimeout.current);
      }
    };
  }, []);

  const baseTimelineWidth = screenWidth - 40;
  const timelineWidth = baseTimelineWidth * zoomLevel;
  const pixelsPerSecond = timelineWidth / duration;

  // Calculate tick interval based on zoom level
  const getTickInterval = () => {
    if (zoomLevel >= 2.5) return 0.5;
    if (zoomLevel >= 1.5) return 1;
    if (zoomLevel >= 1) return 2;
    if (zoomLevel >= 0.7) return 5;
    return 10;
  };

  const tickInterval = getTickInterval();
  const numTicks = Math.ceil(duration / tickInterval) + 1;

  return (
    <View style={styles.container} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {/* Zoom indicator */}
      {showZoomIndicator && (
        <View style={styles.zoomIndicator}>
          <Text style={styles.zoomIndicatorText}>{zoomLevel.toFixed(1)}x</Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.timeText}>{formatTime(trimStart)}</Text>
        <Text style={styles.durationText}>
          Duración: {formatTime(trimEnd - trimStart)}
        </Text>
        <Text style={styles.timeText}>{formatTime(trimEnd)}</Text>
      </View>

      <View style={styles.timelineContainer}>
        <View style={[styles.track, { width: timelineWidth }]}>
          {/* Time tick marks */}
          {Array.from({ length: numTicks }, (_, i) => {
            const time = i * tickInterval;
            if (time > duration) return null;
            const isMajor = time % (tickInterval * 2) === 0 || tickInterval <= 1;
            return (
              <View key={i} style={[styles.tickContainer, { left: time * pixelsPerSecond }]}>
                <View style={[styles.tick, isMajor ? styles.tickMajor : styles.tickMinor]} />
                {isMajor && (
                  <Text style={styles.tickLabelMajor}>
                    {formatTime(time)}
                  </Text>
                )}
              </View>
            );
          })}

          {/* B-roll markers */}
          {bRollMarkers.map((time, index) => (
            <View
              key={index}
              style={[
                styles.bRollMarker,
                { left: time * pixelsPerSecond },
              ]}
            />
          ))}

          {/* Trim selection */}
          <View
            style={[
              styles.trimSelection,
              {
                left: trimStart * pixelsPerSecond,
                width: (trimEnd - trimStart) * pixelsPerSecond,
              },
            ]}
          />

          {/* Trim handles */}
          <TrimHandles
            trimStart={trimStart}
            trimEnd={trimEnd}
            duration={duration}
            pixelsPerSecond={pixelsPerSecond}
            onTrimStartChange={onTrimStartChange}
            onTrimEndChange={onTrimEndChange}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Arrastra los extremos para ajustar</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  zoomIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    zIndex: 100,
  },
  zoomIndicatorText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  timeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  durationText: {
    color: '#888',
    fontSize: 14,
  },
  timelineContainer: {
    alignItems: 'center',
  },
  track: {
    height: 60,
    minWidth: 300,
    backgroundColor: '#444',
    borderRadius: 4,
    position: 'relative',
  },
  tickContainer: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  tick: {
    width: 1,
  },
  tickMajor: {
    height: 12,
    backgroundColor: '#888',
  },
  tickMinor: {
    height: 6,
    backgroundColor: '#666',
  },
  tickLabelMajor: {
    fontSize: 10,
    color: '#aaa',
    fontWeight: '600',
    marginTop: 2,
  },
  bRollMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#ffd700',
  },
  trimSelection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 122, 255, 0.4)',
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
  },
  footer: {
    marginTop: 16,
    alignItems: 'center',
  },
  footerText: {
    color: '#888',
    fontSize: 12,
  },
});
