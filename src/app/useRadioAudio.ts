import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_STREAM_URL = 'https://stream.zeno.fm/ywcmn7hpha0uv';

export interface UseRadioAudioResult {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  isRadioPlaying: boolean;
  setIsRadioPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  toggleRadio: () => void;
}

/**
 * Free-look toolbar radio: Audio element + Web Audio graph lifecycle / toggle.
 * Car-mode audio remains a separate path in CarModeView.
 */
export function useRadioAudio(streamUrl: string = DEFAULT_STREAM_URL): UseRadioAudioResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);

  useEffect(() => {
    if (!audioRef.current) {
      const el = new Audio(streamUrl);
      el.crossOrigin = 'anonymous';
      audioRef.current = el;
    }
    return () => {
      audioCtxRef.current?.close();
    };
  }, [streamUrl]);

  const toggleRadio = useCallback(() => {
    if (!audioRef.current) return;
    if (isRadioPlaying) {
      audioRef.current.pause();
    } else {
      if (!audioCtxRef.current) {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        if (!audioSourceRef.current) {
          audioSourceRef.current = ctx.createMediaElementSource(audioRef.current);
          audioSourceRef.current.connect(ctx.destination);
        }
      }
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume();
      }
      audioRef.current.play().catch((e) => console.error('Audio play failed:', e));
    }
    setIsRadioPlaying(!isRadioPlaying);
  }, [isRadioPlaying]);

  return { audioRef, isRadioPlaying, setIsRadioPlaying, toggleRadio };
}
