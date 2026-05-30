import { useVideoPlayer as useExpoVideoPlayer } from 'expo-video';
import { useEffect, useState, useCallback } from 'react';

export function useAppVideoPlayer(source: string) {
  const player = useExpoVideoPlayer(source, (player) => {
    player.loop = true;
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Poll currentTime every 100ms while playing
  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      setCurrentTime(player.currentTime);
      setDuration(player.duration);
    }, 100);
    return () => clearInterval(interval);
  }, [player]);

  const play = useCallback(() => { player.play(); setIsPlaying(true); }, [player]);
  const pause = useCallback(() => { player.pause(); setIsPlaying(false); }, [player]);
  const seekTo = useCallback((time: number) => { player.currentTime = time; setCurrentTime(time); }, [player]);

  // Loop within trim range
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('playToEnd', () => {
      // Handled by loop=true on the player
    });
    return () => sub?.remove();
  }, [player]);

  return { player, currentTime, duration, isPlaying, play, pause, seekTo };
}
