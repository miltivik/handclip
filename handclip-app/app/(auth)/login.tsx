import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';
import { useGoogleAuth } from '../../hooks/useGoogleAuth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const signIn = useAuthStore((state) => state.signIn);
  const signInWithMagicLink = useAuthStore((state) => state.signInWithMagicLink);
  const promptGoogle = useGoogleAuth();

  const handleSignIn = async () => {
    if (!email || !password) {
      setErrorMessage('Por favor completa todos los campos');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await signIn(email, password);
      router.replace('/');
    } catch (error: any) {
      setErrorMessage(error.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      await promptGoogle();
    } catch (error: any) {
      setErrorMessage(error.message || 'Error al iniciar con Google');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      setErrorMessage('Ingresa tu correo para recibir el enlace');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await signInWithMagicLink(email);
      setMagicLinkSent(true);
    } catch (error: any) {
      setErrorMessage(error.message || 'Error al enviar el enlace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">HandClip</Text>
          <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="tu@email.com"
              placeholderTextColor="#6B7280"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Correo electrónico"
              textContentType="emailAddress"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Contraseña</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#6B7280"
              secureTextEntry
              accessibilityLabel="Contraseña"
              textContentType="password"
            />
          </View>

          {errorMessage ? (
            <Text style={styles.errorText} accessibilityRole="alert">{errorMessage}</Text>
          ) : null}

          {magicLinkSent ? (
            <Text style={styles.successText} accessibilityRole="alert">
              Te enviamos un enlace mágico a {email}. Revisa tu correo.
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={loading}
            accessibilityLabel="Iniciar sesión"
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Iniciar sesión</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.googleButton, loading && styles.buttonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={loading}
            accessibilityLabel="Continuar con Google"
            accessibilityRole="button"
          >
            <Text style={styles.googleButtonText}>G  Continuar con Google</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.magicLinkButton}
            onPress={handleMagicLink}
            disabled={loading}
            accessibilityLabel="Enviar enlace mágico al correo"
            accessibilityRole="button"
          >
            <Text style={styles.magicLinkText}>Enviar enlace mágico</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkContainer}
            onPress={() => router.push('/signup')}
            accessibilityLabel="Ir a la pantalla de registro"
            accessibilityRole="link"
          >
            <Text style={styles.linkText}>
              ¿No tienes cuenta?{' '}
              <Text style={styles.linkTextBold}>Regístrate</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#111827',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 8,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: '#111827',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  successText: {
    color: '#059669',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  googleButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  magicLinkButton: {
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  magicLinkText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
  },
  linkContainer: {
    alignItems: 'center',
  },
  linkText: {
    color: '#6B7280',
    fontSize: 14,
  },
  linkTextBold: {
    color: '#4F46E5',
    fontWeight: '600',
  },
});
