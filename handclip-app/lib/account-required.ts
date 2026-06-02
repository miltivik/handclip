import { Alert } from 'react-native';
import { router } from 'expo-router';

export function showAccountRequired(): void {
  Alert.alert(
    'Cuenta requerida',
    'Necesitas una cuenta para usar analisis IA y guardar proyectos.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Iniciar sesion', onPress: () => router.push('/(auth)/login') },
      { text: 'Crear cuenta', onPress: () => router.push('/(auth)/signup') },
    ],
  );
}
