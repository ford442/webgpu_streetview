import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioAnalyzer } from '../../audio/AudioAnalyzer';
import { getTopStationForLocation } from '../../services/radioBrowserService';
import { isRegionChange, shouldRequeryRadio, type TunedStation } from '../../services/radio/tripRadio';
import { setCarMediaInfo } from '../../car';

export interface UseCabinRadioBindingOptions {
  panorama: google.maps.StreetViewPanorama | null;
  /** Current pano position; the radio follows the trip as it changes. */
  position?: google.maps.LatLng | null;
}

export interface UseCabinRadioBindingResult {
  isRadioPlaying: boolean;
  audioElement: HTMLAudioElement | null;
  analyserNode: AnalyserNode | null;
  stationName: string;
  stationTags: string;
  handleToggleRadio: () => Promise<void>;
  /** The driver's choice: a pinned station is never retuned by the trip. */
  stationPinned: boolean;
  togglePinStation: () => void;
}

export function useCabinRadioBinding({
  panorama,
  position = null,
}: UseCabinRadioBindingOptions): UseCabinRadioBindingResult {
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [stationName, setStationName] = useState('');
  const [stationTags, setStationTags] = useState('');
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const [stationPinned, setStationPinned] = useState(false);
  const tunedRef = useRef<TunedStation | null>(null);
  const retuningRef = useRef(false);
  const togglePinStation = useCallback(() => setStationPinned((p) => !p), []);

  // Trip-aware radio: after > 50 km, look for the best local station and fade
  // to it if it is in another region. Never while the driver has pinned one.
  const lat = position?.lat();
  const lng = position?.lng();
  useEffect(() => {
    if (!isRadioPlaying || lat === undefined || lng === undefined || retuningRef.current) return;
    const tuned = tunedRef.current;
    if (!tuned || !shouldRequeryRadio(tuned, { lat, lng }, stationPinned)) return;
    retuningRef.current = true;
    void (async () => {
      try {
        const station = await getTopStationForLocation(lat, lng);
        const analyzer = audioAnalyzerRef.current;
        if (station && analyzer && isRegionChange(tuned, station)) {
          await analyzer.crossfadeTo(station.urlResolved || station.url);
          analyzer.setStationInfo(station.name, station.tags);
          setStationName(station.name);
          setStationTags(station.tags);
          tunedRef.current = { id: station.id, country: station.country, state: station.state, lat, lng };
        } else {
          // Same region: keep playing, and measure the next 50 km from here.
          tunedRef.current = { ...tuned, lat, lng };
        }
      } finally {
        retuningRef.current = false;
      }
    })();
  }, [isRadioPlaying, lat, lng, stationPinned]);

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
      let tuned: TunedStation | null = null;

      if (pos) {
        const station = await getTopStationForLocation(pos.lat(), pos.lng());
        if (station) {
          streamUrl = station.urlResolved || station.url;
          name = station.name;
          tags = station.tags;
        }
        tuned = {
          id: station?.id ?? '', country: station?.country ?? '', state: station?.state ?? '',
          lat: pos.lat(), lng: pos.lng(),
        };
      }

      if (!audioElement) {
        const initialized = await audioAnalyzerRef.current.init(streamUrl);
        if (initialized) {
          audioAnalyzerRef.current.setStationInfo(name, tags);
          tunedRef.current = tuned;
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
    stationPinned,
    togglePinStation,
  };
}
