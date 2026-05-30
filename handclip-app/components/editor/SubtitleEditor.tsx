import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Modal } from 'react-native';

interface Props {
  visible: boolean;
  initialText: string;
  startTime: number;
  endTime: number;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export default function SubtitleEditor({
  visible,
  initialText,
  startTime,
  endTime,
  onSave,
  onCancel,
}: Props) {
  const [text, setText] = useState(initialText);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.timestamp}>
            {formatTime(startTime)} - {formatTime(endTime)}
          </Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder="Corrige el texto..."
            placeholderTextColor="#999"
          />
          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.button}>
              <Text style={styles.cancelButton}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onSave(text)} style={styles.button}>
              <Text style={styles.saveButton}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxWidth: 400,
  },
  timestamp: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 16,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelButton: {
    color: '#999',
    fontSize: 16,
  },
  saveButton: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
});