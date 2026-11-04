import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireCarAudioGraph, releaseCarAudioGraph } from '../audio/carAudioGraph';

const DEFAULT_STREAM_URL = 'https://stream.zeno.fm/ywcmn7hpha0uv';

export interface UseRadioAudioResult {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  isRadioPlaying: boolean;
  setIsRadioPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  toggleRadio: () => void;
}

/**
 * Free-look toolbar radio: Audio element + Web Audio graph lifecycle / toggle.
 * It joins `audio/carAudioGraph`: one AudioContext for the app.
 */
export function useRadioAudio(streamUrl: string = DEFAULT_STREAM_URL): UseRadioAudioResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** The shared car/app audio graph, held while the radio has been started. */
  const graphRef = useRef<ReturnType<typeof acquireCarAudioGraph>>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);

  useEffect(() => {
    if (!audioRef.current) {
      const el = new Audio(streamUrl);
      el.crossOrigin = 'anonymous';
      audioRef.current = el;
    }
    return () => {
      // Drop our reference; the shared context is suspended, never closed (the car radio reuses it).
      if (graphRef.current) releaseCarAudioGraph();
      graphRef.current = null;
    };
  }, [streamUrl]);

  const toggleRadio = useCallback(() => {
    if (!audioRef.current) return;
    if (isRadioPlaying) {
      audioRef.current.pause();
    } else {
      if (!graphRef.current) {
        // One AudioContext for the app: nodes cannot connect across contexts, and
        // the car radio already lives on this graph's radioBus.
        graphRef.current = acquireCarAudioGraph();
        if (graphRef.current && !audioSourceRef.current) {
          audioSourceRef.current = graphRef.current.ctx.createMediaElementSource(audioRef.current);
          audioSourceRef.current.connect(graphRef.current.radioBus);
        }
      } else if (graphRef.current.ctx.state === 'suspended') {
        void graphRef.current.ctx.resume();
      }
      audioRef.current.play().catch((e) => console.error('Audio play failed:', e));
    }
    setIsRadioPlaying(!isRadioPlaying);
  }, [isRadioPlaying]);

  return { audioRef, isRadioPlaying, setIsRadioPlaying, toggleRadio };
}
