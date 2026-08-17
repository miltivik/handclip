import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text, Alert, TextInput } from 'react-native';
import { VideoView } from 'expo-video';
import Preview from '../../../components/editor/Preview';
import Timeline from '../../../components/editor/Timeline';
import SubtitleOverlay from '../../../components/editor/SubtitleOverlay';
import SubtitleEditor from '../../../components/editor/SubtitleEditor';
import EditPromptModal from '../../../components/editor/EditPromptModal';
import { useEditorStore } from '../../../stores/editor.store';
import { useProjectStore } from '../../../stores/project.store';
import { useJobsStore, getOrCreateClientRequestId } from '../../../stores/jobs.store';
import { useAppVideoPlayer } from '../../../hooks/useVideoPlayer';
import { useAuthStore } from '../../../stores/auth.store';
import { showAccountRequired } from '../../../lib/account-required';
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_STYLES, type SubtitleStyleId } from '../../../lib/subtitle-styles';
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
  const [editPromptOpen, setEditPromptOpen] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleId>(DEFAULT_SUBTITLE_STYLE);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicUploading, setMusicUploading] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [quota, setQuota] = useState<{
    exportsThisMonth: number;
    maxExports: number | null;
    isUnlimited: boolean;
  } | null>(null);
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
    if (musicUploading) {
      Alert.alert('Audio en progreso', 'Espera a que termine de subirse el audio.');
      return;
    }
    const isAnonymous = useAuthStore.getState().isAnonymous;
    if (isAnonymous) {
      showAccountRequired();
      return;
    }
    try {
      const clientRequestId = getOrCreateClientRequestId(
        id,
        'render',
        { preset, clipId },
      );
      const result = await api.createExportJob(id, {
        clipId,
        trimStart,
        trimEnd,
        subtitles: displaySubtitles,
        preset,
        subtitleStyle,
        musicUrl: musicUrl || undefined,
        musicVolume,
        speed,
        textOverlay: textOverlay?.text.trim() ? textOverlay : null,
        clientRequestId,
      });
      if (result.jobId) {
        useJobsStore.getState().addJob({
          jobId: result.jobId,
          projectId: id,
          type: 'render',
          status: 'queued',
          clientRequestId,
          meta: { preset, clipId },
        });
        useJobsStore.getState().consumeRequest(clientRequestId);
        router.push(`/project/${id}/export?jobId=${result.jobId}&preset=${preset}`);
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo iniciar la exportación');
    }
  };

  const handleEditPrompt = () => {
    if (!id) return;
    const isAnonymous = useAuthStore.getState().isAnonymous;
    if (isAnonymous) {
      showAccountRequired();
      return;
    }
    setEditPromptOpen(true);
  };

  const submitEditPrompt = async (input: string) => {
    if (!id) return;
    setEditPromptOpen(false);
    try {
      const clientRequestId = getOrCreateClientRequestId(id, 'edit_prompt');
      const { jobId } = await api.submitEditPrompt(id, { prompt: input.trim(), clientRequestId });
      useJobsStore.getState().consumeRequest(clientRequestId);
      // The server may immediately reject the request as "not
      // implemented" by marking the job failed in the DB. Pull the
      // current status before showing a misleading success message.
      const latest = await api.getJob(jobId);
      if (latest.status === 'FAILED') {
        const reason = latest.failedReason ?? 'La edición por prompt aún no está disponible.';
        Alert.alert('Función no disponible', reason);
        return;
      }
      useJobsStore.getState().addJob({
        jobId,
        projectId: id,
        type: 'edit_prompt',
        status: 'queued',
        clientRequestId,
      });
      Alert.alert('Edición enviada', 'Te avisaremos cuando termine de aplicarse.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo enviar la edición');
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
        const asset = result.assets[0];
        setMusicUploading(true);
        const { storagePath } = await api.uploadAudio({
          uri: asset.uri,
          fileName: asset.name ?? 'audio.mp3',
          mimeType: asset.mimeType ?? 'audio/mpeg',
          fileSize: asset.size,
        });
        setMusicUrl(storagePath);
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo subir el archivo de audio');
    } finally {
      setMusicUploading(false);
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
      <EditPromptModal
        visible={editPromptOpen}
        onCancel={() => setEditPromptOpen(false)}
        onSubmit={submitEditPrompt}
      />
      {/* Music import */}
      <View style={styles.musicSection}>
        <Text style={styles.musicLabel}>🎵 Música</Text>
        {!musicUrl ? (
          <TouchableOpacity 
            style={[styles.musicSelectButton, musicUploading && styles.musicSelectButtonDisabled]}
            onPress={handleSelectMusic}
            disabled={musicUploading}
            accessibilityLabel="Seleccionar archivo de audio"
            accessibilityRole="button"
          >
            <Text style={styles.musicSelectButtonText}>
              {musicUploading ? 'Subiendo audio...' : 'Seleccionar audio'}
            </Text>
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
        {/* Subtitle style selector */}
        <View style={styles.subtitleStyleSection}>
          <Text style={styles.speedLabel}>Estilo de subtítulos</Text>
          <View style={styles.subtitleStyleOptions}>
            {SUBTITLE_STYLES.map((style) => {
              const selected = subtitleStyle === style.id;
              return (
                <TouchableOpacity
                  key={style.id}
                  style={[
                    styles.subtitleStyleButton,
                    selected && styles.subtitleStyleButtonSelected,
                  ]}
                  onPress={() => setSubtitleStyle(style.id)}
                  accessibilityRole="button"
                  accessibilityLabel={'Estilo de subtítulos ' + style.label}
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.subtitleStylePreview,
                      { color: style.color, textShadowColor: style.outline },
                      style.uppercase && styles.subtitleStylePreviewUpper,
                    ]}
                    numberOfLines={1}
                  >
                    Aa
                  </Text>
                  <Text
                    style={[
                      styles.subtitleStyleLabel,
                      selected && styles.subtitleStyleLabelSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {style.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
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
                !quota.isUnlimited &&
                  quota.maxExports !== null &&
                  quota.exportsThisMonth >= quota.maxExports &&
                  styles.quotaTextDanger,
              ]}
            >
              {quota.isUnlimited || quota.maxExports === null
                ? 'Exports ilimitados'
                : `${quota.maxExports - quota.exportsThisMonth} / ${quota.maxExports} exports restantes`}
            </Text>
            {!quota.isUnlimited && quota.maxExports !== null && quota.exportsThisMonth >= quota.maxExports && (
              <Text style={styles.quotaWarningText}>Límite de exportaciones alcanzado</Text>
            )}
          </View>
        ) : null}
        <TouchableOpacity
          style={[
            styles.exportButton,
            quota?.exportsThisMonth !== undefined &&
              !quota.isUnlimited &&
              quota.maxExports !== null &&
              quota.exportsThisMonth >= quota.maxExports &&
              styles.exportButtonDisabled,
          ]}
          onPress={handleExport}
          disabled={
            quota?.exportsThisMonth !== undefined &&
            !quota.isUnlimited &&
            quota.maxExports !== null &&
            quota.exportsThisMonth >= quota.maxExports
          }
          accessibilityLabel="Exportar clip"
          accessibilityRole="button"
        >
          <Text style={styles.exportButtonText}>Exportar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.promptButton}
          onPress={handleEditPrompt}
          accessibilityLabel="Editar por prompt"
          accessibilityRole="button"
        >
          <Text style={styles.promptButtonText}>Editar por prompt</Text>
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
  musicSelectButtonDisabled: {
    opacity: 0.6,
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
  // Subtitle style selector styles
  subtitleStyleSection: {
    marginBottom: 16,
  },
  subtitleStyleOptions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  subtitleStyleButton: {
    backgroundColor: '#333',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    minWidth: 62,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  subtitleStyleButtonSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#1c2a3a',
  },
  subtitleStylePreview: {
    fontSize: 18,
    fontWeight: '700',
    textShadowRadius: 2,
    textShadowOffset: { width: 1, height: 1 },
  },
  subtitleStylePreviewUpper: {
    textTransform: 'uppercase',
  },
  subtitleStyleLabel: {
    color: '#aaa',
    fontSize: 11,
    marginTop: 2,
  },
  subtitleStyleLabelSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  // Text overlay styles
  textOverlaySection: {
    marginBottom: 16,
  },  textOverlayLabel: {
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
  promptButton: {
    backgroundColor: '#1f2937',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
  },
  promptButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
