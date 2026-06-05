import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';
import { useAppTheme } from '../../lib/theme';

export default function LoginScreen() {
  const { theme } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const signIn = useAuthStore((state) => state.signIn);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithMagicLink = useAuthStore((state) => state.signInWithMagicLink);
  const continueAnonymously = useAuthStore((state) => state.continueAnonymously);

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
      await signInWithGoogle();
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

  const handleContinueAnonymously = () => {
    continueAnonymously();
    router.replace('/(tabs)/home');
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logoMark}
            resizeMode="contain"
            accessibilityLabel="HandClip"
            accessibilityIgnoresInvertColors
          />
          <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
            HandClip
          </Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>Inicia sesión para continuar</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: theme.text }]}>Correo electrónico</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text },
              ]}
              value={email}
              onChangeText={setEmail}
              placeholder="tu@email.com"
              placeholderTextColor={theme.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Correo electrónico"
              textContentType="emailAddress"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: theme.text }]}>Contraseña</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text },
              ]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={theme.muted}
              secureTextEntry
              accessibilityLabel="Contraseña"
              textContentType="password"
            />
          </View>

          {errorMessage ? (
            <Text style={[styles.errorText, { color: theme.danger }]} accessibilityRole="alert">
              {errorMessage}
            </Text>
          ) : null}

          {magicLinkSent ? (
            <Text
              style={[
                styles.successText,
                { color: theme.success, backgroundColor: theme.surface },
              ]}
              accessibilityRole="alert"
            >
              Te enviamos un enlace mágico a {email}. Revisa tu correo.
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.text }, loading && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={loading}
            accessibilityLabel="Iniciar sesión"
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <Text style={[styles.buttonText, { color: theme.background }]}>Iniciar sesión</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.googleButton,
              { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
              loading && styles.buttonDisabled,
            ]}
            onPress={handleGoogleSignIn}
            disabled={loading}
            accessibilityLabel="Continuar con Google"
            accessibilityRole="button"
          >
            <Text style={[styles.googleButtonText, { color: theme.text }]}>
              G  Continuar con Google
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.magicLinkButton}
            onPress={handleMagicLink}
            disabled={loading}
            accessibilityLabel="Enviar enlace mágico al correo"
            accessibilityRole="button"
          >
            <Text style={[styles.magicLinkText, { color: theme.primary }]}>Enviar enlace mágico</Text>
          </TouchableOpacity>

          {__DEV__ && (
            <TouchableOpacity
              style={[styles.anonymousButton, { borderColor: theme.border }]}
              onPress={handleContinueAnonymously}
              accessibilityLabel="Continuar anónimamente"
              accessibilityRole="button"
            >
              <Text style={[styles.anonymousButtonText, { color: theme.text }]}>Continuar anónimamente</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.linkContainer}
            onPress={() => router.push('/signup')}
            accessibilityLabel="Ir a la pantalla de registro"
            accessibilityRole="link"
          >
            <Text style={[styles.linkText, { color: theme.muted }]}>
              ¿No tienes cuenta?{' '}
              <Text style={[styles.linkTextBold, { color: theme.text }]}>Regístrate</Text>
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
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoMark: {
    width: 72,
    height: 72,
    marginBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
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
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
  },
  errorText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  successText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
    padding: 12,
    borderRadius: 8,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
    minHeight: 44,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  googleButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1.5,
    marginBottom: 12,
    minHeight: 44,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  magicLinkButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 20,
    minHeight: 44,
  },
  magicLinkText: {
    fontSize: 14,
    fontWeight: '500',
  },
  anonymousButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 44,
  },
  anonymousButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  linkContainer: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    fontSize: 14,
  },
  linkTextBold: {
    fontWeight: '600',
  },
});
