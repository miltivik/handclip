import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
import { VideoView } from 'expo-video';
import Preview from '../../../components/editor/Preview';
import Timeline from '../../../components/editor/Timeline';
import { useEditorStore } from '../../../stores/editor.store';
import { useProjectStore } from '../../../stores/project.store';
import { useAppVideoPlayer } from '../../../hooks/useVideoPlayer';
import { api } from '../../../services/api';

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
  } = useEditorStore();

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
    if (!id) return;
    fetchProject(id);
    fetchClips(id);
  }, [id, fetchProject, fetchClips]);

  // Load subtitles when clipId changes
  useEffect(() => {
    if (!id || !clipId) return;
    fetchSubtitles(id, clipId);
  }, [id, clipId, fetchSubtitles]);

  // Find selected clip and set trim handles from clip's actual times
  useEffect(() => {
    if (!clips.length || !clipId) return;
    const selectedClip = clips.find((c) => c.id === clipId);
    if (selectedClip) {
      setTrimStart(selectedClip.startTime);
      setTrimEnd(selectedClip.endTime);
    }
  }, [clips, clipId, setTrimStart, setTrimEnd]);

  const videoUrl = currentProject?.sourceVideoUrl || '';
  const { player, currentTime, duration } = useAppVideoPlayer(videoUrl);

  const handleExport = async () => {
    if (!clipId) {
      Alert.alert('Error', 'No hay un clip seleccionado');
      return;
    }
    try {
      // Use subtitles from editor store or project store
      const exportSubtitles = subtitles.length > 0 ? subtitles : projectSubtitles.map((s) => ({
        id: s.id,
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
      }));

      const result = await api.exportClip(id!, {
        clipId,
        trimStart,
        trimEnd,
        subtitles: exportSubtitles,
        preset,
      });
      router.push(`/project/${id}/export?jobId=${result.jobId}&preset=${preset}`);
    } catch (err) {
      Alert.alert('Error al iniciar exportación', err instanceof Error ? err.message : 'Error desconocido');
    }
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
        <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
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
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  timelineContainer: {
    height: 200,
    backgroundColor: '#2a2a2a',
  },
  footer: {
    padding: 16,
    backgroundColor: '#1a1a1a',
  },
  exportButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
