import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { completeAuthCallback } from '../../lib/auth-callback';
import { supabase } from '../../services/supabase';

export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function handleCallback() {
      const callbackUrl = url ?? (await Linking.getInitialURL());

      if (!callbackUrl) {
        if (active) setErrorMessage('No auth callback URL found.');
        return;
      }

      try {
        await completeAuthCallback(callbackUrl);
        if (active) router.replace('/');
      } catch (error: any) {
        const session = await waitForSession();
        if (session) {
          if (active) router.replace('/');
          return;
        }

        if (active) {
          setErrorMessage(error.message ?? 'No se pudo completar el inicio de sesion.');
        }
      }
    }

    handleCallback();

    return () => {
      active = false;
    };
  }, [url]);

  return (
    <View style={styles.container}>
      {errorMessage ? (
        <>
          <Text style={styles.title}>Error de acceso</Text>
          <Text style={styles.message} selectable accessibilityRole="alert">
            {errorMessage}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/login')}
            accessibilityRole="button"
            accessibilityLabel="Volver a inicio de sesion"
          >
            <Text style={styles.buttonText}>Volver a iniciar sesion</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color="#007AFF" accessibilityLabel="Completando acceso" />
          <Text style={styles.message}>Completando acceso...</Text>
        </>
      )}
    </View>
  );
}

async function waitForSession() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#111827',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
