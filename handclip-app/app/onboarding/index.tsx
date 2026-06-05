import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';
import { markOnboardingSeen } from '../../lib/onboarding';

type IconName = keyof typeof Ionicons.glyphMap;

const { width } = Dimensions.get('window');

const STEPS: { icon: IconName; title: string; description: string }[] = [
  {
    icon: 'videocam-outline',
    title: 'Encuentra los mejores momentos',
    description:
      'HandClip analiza tu video y detecta los clips con más potencial automáticamente.',
  },
  {
    icon: 'cut-outline',
    title: 'Edita rápido',
    description:
      'Recorta, añade subtítulos y ajusta el formato vertical en segundos.',
  },
  {
    icon: 'share-outline',
    title: 'Exporta y comparte',
    description:
      'Exporta tus clips en formato TikTok, Reels o Shorts y compártelos al instante.',
  },
];

export default function OnboardingScreen() {
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const isFinalStep = currentStep === STEPS.length - 1;
  const completeLabel =
    isAuthenticated || isAnonymous ? 'Comenzar' : 'Crear cuenta o iniciar sesión';
  const accountNote = isAuthenticated
    ? 'Tu cuenta guardará proyectos, exportaciones y conexiones de IA.'
    : isAnonymous
      ? 'Modo exploración activo. Para guardar proyectos, inicia sesión luego.'
      : 'Necesitas una cuenta para guardar proyectos y conectar IA.';

  function scrollToIndex(index: number) {
    const nextIndex = Math.max(0, Math.min(index, STEPS.length - 1));
    setCurrentStep(nextIndex);
    scrollViewRef.current?.scrollTo({ x: width * nextIndex, animated: true });
  }

  async function handleComplete() {
    setSaving(true);
    let hasSession = isAuthenticated;
    try {
      const result = await markOnboardingSeen();
      hasSession = result.isAuthenticated || isAuthenticated;
    } catch {
      // Non-fatal: proceed regardless
    }
    router.replace(hasSession || isAnonymous ? '/(tabs)/home' : '/login');
  }

  if (saving) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" accessibilityLabel="Guardando..." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ width: width * STEPS.length, flexDirection: 'row' }}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentStep(index);
        }}
        scrollEventThrottle={16}
      >
        {STEPS.map((step, index) => (
          <View key={index} style={[styles.stepContainer, { width }]}>
            <View style={styles.iconWrapper}>
              <Ionicons name={step.icon} size={80} color="#007AFF" />
            </View>
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.description}>{step.description}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {STEPS.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index === currentStep ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            if (!isFinalStep) {
              scrollToIndex(currentStep + 1);
            } else {
              handleComplete();
            }
          }}
          accessibilityLabel={!isFinalStep ? 'Siguiente' : completeLabel}
        >
          <Text style={styles.buttonText}>{!isFinalStep ? 'Siguiente' : completeLabel}</Text>
        </TouchableOpacity>

        {isFinalStep ? <Text style={styles.accountNote}>{accountNote}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  stepContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  iconWrapper: {
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
    gap: 24,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: '#007AFF',
  },
  dotInactive: {
    backgroundColor: '#ccc',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  accountNote: {
    color: '#666',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
