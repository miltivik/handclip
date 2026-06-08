import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface EditPromptModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (prompt: string) => void;
}

const MAX_PROMPT_LENGTH = 2000;
const PLACEHOLDER = 'Describe el cambio que quieres aplicar (ej: "Recorta los silencios").';

/**
 * Cross-platform prompt input. `Alert.prompt` is iOS-only and silently
 * no-ops on Android, so this modal is the supported path for both.
 */
export default function EditPromptModal({ visible, onCancel, onSubmit }: EditPromptModalProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_PROMPT_LENGTH;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={onCancel}
        accessibilityLabel="Cerrar"
        accessibilityRole="button"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.center}
          pointerEvents="box-none"
        >
          <Pressable style={styles.card} onPress={() => null}>
            <Text style={styles.title}>Editar por prompt</Text>
            <Text style={styles.subtitle}>{PLACEHOLDER}</Text>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={MAX_PROMPT_LENGTH}
              placeholder="Escribe tu instrucción..."
              placeholderTextColor="#9ca3af"
              autoFocus
              accessibilityLabel="Instrucción de edición"
            />
            <Text style={styles.counter}>
              {trimmed.length} / {MAX_PROMPT_LENGTH}
            </Text>
            <View style={styles.actions}>
              <Pressable
                style={[styles.button, styles.buttonCancel]}
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancelar"
              >
                <Text style={styles.buttonCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.buttonSubmit, !canSubmit && styles.buttonDisabled]}
                onPress={() => canSubmit && onSubmit(trimmed)}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel="Enviar"
                accessibilityState={{ disabled: !canSubmit }}
              >
                <Text style={styles.buttonSubmitText}>Enviar</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 480,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
  },
  input: {
    minHeight: 96,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#111',
    textAlignVertical: 'top',
  },
  counter: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 8,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 96,
    alignItems: 'center',
  },
  buttonCancel: {
    backgroundColor: '#f3f4f6',
  },
  buttonCancelText: {
    color: '#111',
    fontWeight: '600',
  },
  buttonSubmit: {
    backgroundColor: '#111827',
  },
  buttonSubmitText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
