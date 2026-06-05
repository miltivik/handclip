import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text, Alert, TextInput } from 'react-native';
import { VideoView } from 'expo-video';
import Preview from '../../../components/editor/Preview';
import Timeline from '../../../components/editor/Timeline';
import SubtitleOverlay from '../../../components/editor/SubtitleOverlay';
import SubtitleEditor from '../../../components/editor/SubtitleEditor';
import { useEditorStore } from '../../../stores/editor.store';
import { useProjectStore } from '../../../stores/project.store';
import { useAppVideoPlayer } from '../../../hooks/useVideoPlayer';
import { useAuthStore } from '../../../stores/auth.store';
import { showAccountRequired } from '../../../lib/account-required';
import { api } from '../../../services/api';
interface EditingSubtitle {
  index: number;
  text: string;
  startTime: number;
  endTime: number;
}

export default function EditScreen() {
  const { id, clipId } = useLocalSearchParams<{ id: string; clipId: string }>();
  const router = useRouter();

  const {
    trimStart,
    trimEnd,
    subtitles,
    preset,
    speed,
    textOverlay,
    setTrimStart,
    setTrimEnd,
    setSubtitles,
    setSpeed,
    setTextOverlay,
  } = useEditorStore();
  const [editingSubtitle, setEditingSubtitle] = useState<EditingSubtitle | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [quota, setQuota] = useState<{ exportsThisMonth: number; maxExports: number } | null>(null);
  const {
    currentProject,
    clips,
    fetchProject,
    fetchClips,
    fetchSubtitles,
    subtitles: projectSubtitles,
  } = useProjectStore();

  // Load project, clips, and subtitles on mount
  useEffect(() => {
    if (id) {
      fetchProject(id);
      fetchClips(id);
    }
  }, [id, fetchProject, fetchClips]);

  // Load subtitles when clipId changes
  useEffect(() => {
    if (id && clipId) {
      fetchSubtitles(id, clipId);
    }
  }, [id, clipId, fetchSubtitles]);
  // Load quota on mount
  useEffect(() => {
    api.getQuota().then(setQuota).catch(() => null);
  }, []);

  // Find selected clip and set trim handles from clip's actual times
  useEffect(() => {
    if (clips.length > 0 && clipId) {
      const selectedClip = clips.find((c) => c.id === clipId);
      if (selectedClip) {
        setTrimStart(selectedClip.startTime);
        setTrimEnd(selectedClip.endTime);
      }
    }
  }, [clips, clipId, setTrimStart, setTrimEnd]);

  const videoUrl = currentProject?.sourceVideoUrl || '';
  const { player, currentTime, duration } = useAppVideoPlayer(videoUrl);

  const handleExport = async () => {
    if (!id || !clipId) return;
    const isAnonymous = useAuthStore.getState().isAnonymous;
    if (isAnonymous) {
      showAccountRequired();
      return;
    }
    try {
      const result = await api.createExportJob(id, {
        clipId,
        trimStart,
        trimEnd,
        subtitles: displaySubtitles,
        preset,
        musicUrl: musicUrl || undefined,
        musicVolume,
        speed,
        textOverlay: textOverlay?.text.trim() ? textOverlay : null,
      });
      if (result.jobId) {
        router.push(`/project/${id}/export?jobId=${result.jobId}&preset=${preset}`);
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo iniciar la exportación');
    }
  };
  const handleSubtitleTap = (index: number, text: string, startTime: number, endTime: number) => {
    setEditingSubtitle({ index, text, startTime, endTime });
  };
  const handleSubtitleSave = (newText: string) => {
    if (editingSubtitle) {
      const updated = [...subtitles];
      updated[editingSubtitle.index] = { ...updated[editingSubtitle.index], text: newText };
      setSubtitles(updated);
      setEditingSubtitle(null);
    }
  };
  const handleSubtitleCancel = () => {
    setEditingSubtitle(null);
  };
  const handleSelectMusic = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
      });
      if (result.canceled === false && result.assets && result.assets[0]) {
        setMusicUrl(result.assets[0].uri);
      }
    } catch (err) {
      Alert.alert('Error', 'No se pudo seleccionar el archivo de audio');
    }
  };
  const handleRemoveMusic = () => {
    setMusicUrl(null);
  };
  const handleVolumeChange = (delta: number) => {
    setMusicVolume((prev) => Math.max(0, Math.min(2, prev + delta)));
  };
  const displaySubtitles = subtitles.length > 0 ? subtitles : projectSubtitles;
  const SPEED_OPTIONS: (0.5 | 1 | 2)[] = [0.5, 1, 2];

  return (
    <View style={styles.container}>
      <View style={styles.previewContainer}>
        {player ? (
          <VideoView
            style={styles.video}
            player={player}
            allowsFullscreen
            allowsPictureInPicture
          />
        ) : (
          <Preview
            videoUri={videoUrl || 'placeholder'}
            subtitles={displaySubtitles}
            currentTime={currentTime}
          />
        )}
        <SubtitleOverlay
          subtitles={displaySubtitles}
          currentTime={currentTime}
          position="bottom"
          onSubtitleTap={handleSubtitleTap}
        />
      </View>
      {editingSubtitle && (
        <SubtitleEditor
          visible={true}
          initialText={editingSubtitle.text}
          startTime={editingSubtitle.startTime}
          endTime={editingSubtitle.endTime}
          onSave={handleSubtitleSave}
          onCancel={handleSubtitleCancel}
        />
      )}
      {/* Music import */}
      <View style={styles.musicSection}>
        <Text style={styles.musicLabel}>🎵 Música</Text>
        {!musicUrl ? (
          <TouchableOpacity 
            style={styles.musicSelectButton} 
            onPress={handleSelectMusic}
            accessibilityLabel="Seleccionar archivo de audio"
            accessibilityRole="button"
          >
            <Text style={styles.musicSelectButtonText}>Seleccionar audio</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.musicControls}>
            <Text style={styles.musicFileName}>🎶 Audio agregado</Text>
            <View style={styles.volumeControls}>
              <TouchableOpacity
                style={styles.volumeButton}
                onPress={() => handleVolumeChange(-0.1)}
                accessibilityLabel="Bajar volumen"
                accessibilityRole="button"
              >
                <Text style={styles.volumeButtonText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.volumeLabel}>{Math.round(musicVolume * 100)}%</Text>
              <TouchableOpacity
                style={styles.volumeButton}
                onPress={() => handleVolumeChange(0.1)}
                accessibilityLabel="Subir volumen"
                accessibilityRole="button"
              >
                <Text style={styles.volumeButtonText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity 
              style={styles.removeMusicButton} 
              onPress={handleRemoveMusic}
              accessibilityLabel="Quitar música"
              accessibilityRole="button"
            >
              <Text style={styles.removeMusicButtonText}>Quitar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.timelineContainer}>
        <Timeline
          duration={duration || currentProject?.sourceDuration || 0}
          trimStart={trimStart}
          trimEnd={trimEnd}
          onTrimStartChange={setTrimStart}
          onTrimEndChange={setTrimEnd}
          bRollMarkers={[]}
        />
      </View>

      <View style={styles.footer}>
        {/* Speed selector */}
        <View style={styles.speedSection}>
          <Text style={styles.speedLabel}>Velocidad</Text>
          <View style={styles.speedOptions}>
            {SPEED_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.speedButton,
                  speed === opt && styles.speedButtonSelected,
                ]}
                onPress={() => setSpeed(opt)}
                accessibilityRole="button"
                accessibilityLabel={"Velocidad " + opt + "x"}
              >
                <Text
                  style={[
                    styles.speedButtonText,
                    speed === opt && styles.speedButtonTextSelected,
                  ]}
                >
                  {opt}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {/* Text overlay */}
        <View style={styles.textOverlaySection}>
          <Text style={styles.textOverlayLabel}>Texto overlay</Text>
          <TextInput
            style={styles.textOverlayInput}
            maxLength={120}
            placeholder="Texto sobre el video..."
            placeholderTextColor="#888"
            value={textOverlay?.text || ''}
            onChangeText={(newText) => {
              if (!newText.trim()) {
                setTextOverlay(null);
              } else {
                setTextOverlay({
                  text: newText,
                  position: textOverlay?.position || 'bottom',
                });
              }
            }}
          />
          {(textOverlay?.text || '').trim().length > 0 && (
            <View style={styles.positionButtons}>
              {(['top', 'center', 'bottom'] as const).map((pos) => (
                <TouchableOpacity
                  key={pos}
                  style={[
                    styles.positionButton,
                    textOverlay?.position === pos && styles.positionButtonSelected,
                  ]}
                  onPress={() =>
                    setTextOverlay({
                      text: textOverlay!.text,
                      position: pos,
                    })
                  }
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.positionButtonText,
                      textOverlay?.position === pos && styles.positionButtonTextSelected,
                    ]}
                  >
                    {pos === 'top' ? 'Arriba' : pos === 'center' ? 'Centro' : 'Abajo'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        {quota ? (
          <View style={styles.quotaIndicator}>
            <Text
              style={[
                styles.quotaText,
                quota.exportsThisMonth >= quota.maxExports && styles.quotaTextDanger,
              ]}
            >
              {quota.maxExports - quota.exportsThisMonth} / {quota.maxExports} exports restantes
            </Text>
            {quota.exportsThisMonth >= quota.maxExports && (
              <Text style={styles.quotaWarningText}>Limite de exportaciones alcanzado</Text>
            )}
          </View>
        ) : null}
        <TouchableOpacity
          style={[
            styles.exportButton,
            quota?.exportsThisMonth !== undefined &&
              quota.exportsThisMonth >= quota.maxExports &&
              styles.exportButtonDisabled,
          ]}
          onPress={handleExport}
          disabled={quota?.exportsThisMonth !== undefined && quota.exportsThisMonth >= quota.maxExports}
          accessibilityLabel="Exportar clip"
          accessibilityRole="button"
        >
          <Text style={styles.exportButtonText}>Exportar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    aspectRatio: 9 / 16,
  },
  musicSection: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  musicLabel: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 8,
  },
  musicSelectButton: {
    backgroundColor: '#333',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  musicSelectButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  musicControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  musicFileName: {
    color: '#fff',
    fontSize: 14,
  },
  volumeControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  volumeButton: {
    backgroundColor: '#333',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  volumeButtonText: {
    color: '#fff',
    fontSize: 24,
  },
  volumeLabel: {
    color: '#fff',
    fontSize: 14,
    marginHorizontal: 12,
    minWidth: 48,
    textAlign: 'center',
  },
  removeMusicButton: {
    backgroundColor: '#ff3b30',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  removeMusicButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  timelineContainer: {
    height: 80,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  footer: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  exportButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Speed selector styles
  speedSection: {
    marginBottom: 16,
  },
  speedLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
    textAlign: 'center',
  },
  speedOptions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  speedButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  speedButtonSelected: {
    backgroundColor: '#007AFF',
  },
  speedButtonText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '600',
  },
  speedButtonTextSelected: {
    color: '#fff',
  },
  // Text overlay styles
  textOverlaySection: {
    marginBottom: 16,
  },
  textOverlayLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  textOverlayInput: {
    backgroundColor: '#333',
    color: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 8,
  },
  positionButtons: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  positionButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  positionButtonSelected: {
    backgroundColor: '#007AFF',
  },
  positionButtonText: {
    color: '#333',
    fontSize: 13,
    fontWeight: '600',
  },
  positionButtonTextSelected: {
    color: '#fff',
  },
  quotaIndicator: {
    marginBottom: 12,
    alignItems: 'center',
  },
  quotaText: {
    color: '#888',
    fontSize: 13,
  },
  quotaTextDanger: {
    color: '#DC2626',
    fontWeight: '600',
  },
  quotaWarningText: {
    color: '#DC2626',
    fontSize: 12,
    marginTop: 4,
  },
  exportButtonDisabled: {
    opacity: 0.5,
  },
});