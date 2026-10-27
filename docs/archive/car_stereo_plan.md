# Car Stereo System - Development Plan

## Overview
Enhance the car mode driving experience with a functional in-car stereo system that streams music from multiple sources. The stereo will integrate naturally into the car interior (dashboard or center console) with realistic controls and visual feedback.

## Music Sources

### 1. Noah's Music Collection (storage.noahcohn.com)
- **URL**: `https://storage.noahcohn.com/`
- **Content**: Personal music library
- **Access**: Direct file streaming via HTTP/HTTPS
- **Implementation**:
  - Fetch track list from storage endpoint
  - Stream audio files directly to Web Audio API
  - Support common formats: MP3, FLAC, OGG
  - Implement caching for recently played tracks

### 2. Radio Garden
- **URL**: `http://radio.garden/`
- **Content**: Global radio stations on a 3D globe interface
- **Access**: Hopefully embeddable iframe or API access
- **Implementation**:
  - Research Radio Garden embedding options or API
  - Integrate station selection UI into car dashboard
  - Geolocation-based station suggestions
  - Favorites/bookmarks for frequently listened stations
  - Fallback to alternative radio APIs if direct access unavailable:
    - `radio-browser.info` API (open, free)
    - TuneIn API (requires key)
    - SHOUTcast Directory

### 3. Additional Sources (Future)

| Source | Type | Notes |
|--------|------|-------|
| User's Local Files | File API | Drag & drop or file picker for local MP3s |
| Spotify | Streaming | Requires Spotify Web SDK, premium account |
| YouTube Music | Streaming | API limitations, may require unofficial routes |
| Internet Archive | Archive | Free music archive, live music archive |
| Somafm | Radio | Chill/electronic stations, direct streams |
| JazzRadio.com | Radio | Genre-specific, premium option |

## Stereo UI/UX Design

### Physical Integration
- **Location**: Center console or dashboard-mounted
- **Style**: Matches vehicle interior aesthetic (retro/modern toggle?)
- **Display**: Track info, station name, album art (when available)

### Controls
- **Volume knob** (rotary dial with click for mute)
- **Track/Station seeking** (buttons or swipe)
- **Source selector** (FM/AM/Streaming/Aux)
- **Play/Pause** button
- **Preset buttons** (1-6 for favorite stations)
- **Display toggle** (show/hide track details)

### Visual Feedback
- Backlit buttons when headlights on (`headlightsOn` state)
- LCD-style display glow matching interior lighting
- Spectrum analyzer visualization (optional eye candy)

## Technical Implementation

### Audio Pipeline
```
Source (URL/File) 
    ↓
Web Audio API (AudioContext)
    ↓
GainNode (volume control)
    ↓
AnalyserNode (visualization data)
    ↓
Destination (speakers)
```

### State Management
- Current track/station metadata
- Playback state (playing/paused/buffering)
- Volume level (persisted)
- Source selection
- Preset storage (localStorage)

### Integration Points
- React to `nightIntensity` param for display dimming
- React to `headlightsOn` for button backlighting
- Connect to existing `updateCarMode()` update cycle for UI sync

## API Research Tasks

- [ ] Investigate Radio Garden embedding/terms of use
- [ ] Test CORS headers on storage.noahcohn.com
- [ ] Evaluate radio-browser.info API capabilities
- [ ] Research Spotify Web SDK authentication flow

## Milestones

1. **Phase 1**: Basic streaming from storage.noahcohn.com with simple controls
2. **Phase 2**: Radio Garden or radio-browser.info integration
3. **Phase 3**: Enhanced UI with visualizations and presets
4. **Phase 4**: Additional sources (Spotify, local files)

## Open Questions

- Does Radio Garden allow embedding/API access?
- Can we get album art for streamed tracks?
- Should we support playlist files (.m3u, .pls)?
- Mobile browser audio autoplay restrictions?

---

*Created: 2026-04-09*
