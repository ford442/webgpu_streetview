import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioAnalyzer } from '../../audio/AudioAnalyzer';
import { getTopStationForLocation } from '../../services/radioBrowserService';
import { setCarMediaInfo } from '../../car';

export interface UseCabinRadioBindingOptions {
  panorama: google.maps.StreetViewPanorama | null;
}

export interface UseCabinRadioBindingResult {
  isRadioPlaying: boolean;
  audioElement: HTMLAudioElement | null;
  analyserNode: AnalyserNode | null;
  stationName: string;
  stationTags: string;
  handleToggleRadio: () => Promise<void>;
}

export function useCabinRadioBinding({
  panorama,
}: UseCabinRadioBindingOptions): UseCabinRadioBindingResult {
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [stationName, setStationName] = useState('');
  const [stationTags, setStationTags] = useState('');
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);

  useEffect(() => {
    setCarMediaInfo(stationName, stationTags, isRadioPlaying);
  }, [stationName, stationTags, isRadioPlaying]);

  useEffect(() => () => {
    audioAnalyzerRef.current?.dispose();
    audioAnalyzerRef.current = null;
  }, []);

  const handleToggleRadio = useCallback(async () => {
    const newState = !isRadioPlaying;
    setIsRadioPlaying(newState);

    if (newState) {
      if (!audioAnalyzerRef.current) {
        audioAnalyzerRef.current = new AudioAnalyzer();
      }

      const pos = panorama?.getPosition();
      let streamUrl = 'https://stream.zeno.fm/ywcmn7hpha0uv';
      let name = 'Radio Garden';
      let tags = 'world, ambient';

      if (pos) {
        const station = await getTopStationForLocation(pos.lat(), pos.lng());
        if (station) {
          streamUrl = station.urlResolved || station.url;
          name = station.name;
          tags = station.tags;
        }
      }

      if (!audioElement) {
        const initialized = await audioAnalyzerRef.current.init(streamUrl);
        if (initialized) {
          audioAnalyzerRef.current.setStationInfo(name, tags);
          await audioAnalyzerRef.current.start();
          setAudioElement(audioAnalyzerRef.current.getAudioElement());
          setAnalyserNode(audioAnalyzerRef.current.getAnalyser());
          setStationName(name);
          setStationTags(tags);
        }
      } else {
        await audioAnalyzerRef.current.start();
        setAnalyserNode(audioAnalyzerRef.current.getAnalyser());
      }
    } else {
      audioAnalyzerRef.current?.stop();
    }
  }, [isRadioPlaying, audioElement, panorama]);

  return {
    isRadioPlaying,
    audioElement,
    analyserNode,
    stationName,
    stationTags,
    handleToggleRadio,
  };
}
