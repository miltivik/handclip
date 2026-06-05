import { Stack } from 'expo-router';
import OfflineBanner from '../../components/ui/OfflineBanner';

export default function ProjectLayout() {
  return (
    <>
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}