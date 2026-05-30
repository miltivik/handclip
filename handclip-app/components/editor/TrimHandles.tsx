import { View, StyleSheet, PanResponder, GestureResponderEvent, PanResponderGestureState } from 'react-native';

interface TrimHandlesProps {
  trimStart: number;
  trimEnd: number;
  duration: number;
  pixelsPerSecond: number;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
}

export default function TrimHandles({
  trimStart,
  trimEnd,
  duration,
  pixelsPerSecond,
  onTrimStartChange,
  onTrimEndChange,
}: TrimHandlesProps) {
  const leftHandlePosition = trimStart * pixelsPerSecond;
  const rightHandlePosition = trimEnd * pixelsPerSecond;

  const createPanResponder = (type: 'start' | 'end') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (
        _: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => {
        const deltaSeconds = gestureState.dx / pixelsPerSecond;
        
        if (type === 'start') {
          const newStart = Math.max(0, Math.min(trimEnd - 1, trimStart + deltaSeconds));
          onTrimStartChange(Math.round(newStart));
        } else {
          const newEnd = Math.max(trimStart + 1, Math.min(duration, trimEnd + deltaSeconds));
          onTrimEndChange(Math.round(newEnd));
        }
      },
    });

  const leftPanResponder = createPanResponder('start');
  const rightPanResponder = createPanResponder('end');

  return (
    <>
      <View
        style={[styles.handle, styles.leftHandle, { left: leftHandlePosition - 22 }]}
        {...leftPanResponder.panHandlers}
        accessible={true}
        accessibilityLabel="Inicio del recorte"
        accessibilityRole="adjustable"
      >
        <View style={styles.handleBar} />
      </View>

      <View
        style={[styles.handle, styles.rightHandle, { left: rightHandlePosition - 22 }]}
        {...rightPanResponder.panHandlers}
        accessible={true}
        accessibilityLabel="Fin del recorte"
        accessibilityRole="adjustable"
      >
        <View style={styles.handleBar} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  handle: {
    position: 'absolute',
    top: -10,
    width: 44,
    height: 80,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  leftHandle: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  rightHandle: {
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  handleBar: {
    width: 4,
    height: 24,
    backgroundColor: '#fff',
    borderRadius: 2,
  },
});
