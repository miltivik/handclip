import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../lib/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

type TopBarAction = {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  accessibilityLabel?: string;
};

interface AppTopBarProps {
  title: string;
  rightAction?: TopBarAction;
}

export default function AppTopBar({ title, rightAction }: AppTopBarProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.surfaceElevated,
          borderBottomColor: theme.border,
          minHeight: styles.container.minHeight + insets.top,
          paddingTop: styles.container.paddingTop + insets.top,
        },
      ]}
    >
      <View style={styles.brandGroup}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="HandClip"
          accessibilityIgnoresInvertColors
        />
        <Text
          style={[styles.title, { color: theme.text }]}
          accessibilityRole="header"
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>

      {rightAction ? (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.primary }]}
          onPress={rightAction.onPress}
          accessibilityLabel={rightAction.accessibilityLabel ?? rightAction.label}
          accessibilityRole="button"
        >
          {rightAction.icon ? (
            <Ionicons name={rightAction.icon} size={18} color={theme.primaryText} />
          ) : null}
          <Text style={[styles.actionText, { color: theme.primaryText }]}>
            {rightAction.label}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.actionSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  brandGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  logo: {
    width: 32,
    height: 32,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 20,
    fontWeight: '700',
  },
  actionButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionSpacer: {
    width: 44,
  },
});
