import { View, StyleSheet } from 'react-native';
import EmptyState from '../../components/ui/EmptyState';

export default function LibraryScreen() {
  return (
    <View style={styles.container}>
      <EmptyState
        icon="folder-open-outline"
        title="Aún no tienes clips exportados"
        subtitle="Los clips que exportes aparecerán aquí"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
