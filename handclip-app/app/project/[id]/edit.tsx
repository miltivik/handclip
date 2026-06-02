import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
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
    setTrimStart,
    setTrimEnd,
    setSubtitles,
  } = useEditorStore();
  const [editingSubtitle, setEditingSubtitle] = useState<EditingSubtitle | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.3);
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
      const result = await api.createExportJob(id, clipId, preset);
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
          duration={duration || currentProject?.duration || 0}
          trimStart={trimStart}
          trimEnd={trimEnd}
          onTrimStartChange={setTrimStart}
          onTrimEndChange={setTrimEnd}
          bRollMarkers={[]}
        />
      </View>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.exportButton} 
          onPress={handleExport}
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
});