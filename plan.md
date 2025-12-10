# WebGPU StreetView - Future Development Plan

## Overview
This document outlines potential features and enhancements for the WebGPU StreetView project based on popular Google Maps/StreetView utilities and user needs.

## Current Features (Implemented)
- ✅ Interactive 360° panoramic Street View navigation
- ✅ WebGPU-based fluid simulation rendering
- ✅ Mouse/keyboard controls for pan, zoom, and movement
- ✅ Cruise mode (automatic navigation)
- ✅ **Route plotting for cruise mode** - Plan and follow routes to destinations
- ✅ Mini-map with current location and route visualization
- ✅ Radio integration
- ✅ Enhanced snapshot/screenshot functionality with metadata

## Planned Features

### High Priority

#### 1. Enhanced Snapshot System
- ✅ **Coordinates in filename** - Latitude and longitude
- ✅ **Timestamp metadata** - Date and time of capture
- ⬜ **EXIF metadata embedding** - Store GPS coordinates, heading, pitch in image metadata
- ⬜ **Snapshot gallery** - View and manage previously saved snapshots
- ⬜ **Share functionality** - Direct share to social media or copy link
- ⬜ **Multiple format support** - PNG, JPEG, WebP options

#### 2. Historical Imagery (Time Travel)
- ⬜ **Time slider** - View how locations have changed over time
- ⬜ **Side-by-side comparison** - Compare different time periods
- ⬜ **Timeline visualization** - Show available dates for current location

#### 3. Location Features
- ⬜ **Search functionality** - Search for addresses, landmarks, coordinates
- ⬜ **Bookmarks/Favorites** - Save favorite locations for quick access
- ⬜ **Location history** - Track and revisit previously viewed locations
- ⬜ **POI (Points of Interest) overlay** - Show nearby restaurants, attractions, etc.

#### 4. AR/Compass Integration
- ⬜ **Digital compass** - Show current heading direction
- ⬜ **North indicator** - Always show which way is north
- ⬜ **Coordinate display** - Always-visible lat/lng and heading

### Medium Priority

#### 5. Measurement Tools
- ⬜ **Distance measurement** - Measure distances between points
- ⬜ **Area calculation** - Calculate area of polygons
- ⬜ **Elevation data** - Show altitude/elevation information

#### 6. Customization & Settings
- ⬜ **Theme options** - Light/dark mode, custom color schemes
- ⬜ **Performance settings** - Adjust rendering quality, simulation intensity
- ⬜ **Keyboard shortcuts** - Customizable hotkeys for common actions
- ⬜ **Control sensitivity** - Adjust mouse/keyboard sensitivity

#### 7. Collaboration & Sharing
- ⬜ **Shareable links** - Generate URLs with exact position/heading
- ⬜ **Annotation tools** - Add notes or markers to locations
- ✅ **Route planning** - Plan routes to destinations using Google Directions API
- ⬜ **Tour creation** - Create guided tours through multiple locations
- ⬜ **Export tours** - Save and share tour routes
- ⬜ **Waypoint management** - Add custom waypoints to routes

#### 8. Offline Mode
- ⬜ **Cache management** - Download areas for offline viewing
- ⬜ **Offline snapshot gallery** - Access saved images offline

### Low Priority (Future Exploration)

#### 9. Advanced Rendering
- ⬜ **Weather effects** - Add rain, snow, fog effects
- ⬜ **Time of day simulation** - Simulate different lighting conditions
- ⬜ **Custom filters** - Instagram-like filters for rendering
- ⬜ **3D object placement** - Add virtual objects to scenes

#### 10. Social Features
- ⬜ **User-contributed content** - Allow users to upload 360° photos
- ⬜ **Comments/Reviews** - Add location reviews and tips
- ⬜ **Shared sessions** - Multiple users explore together

#### 11. Data Visualization
- ⬜ **Heatmaps** - Visualize data (traffic, air quality, etc.)
- ⬜ **Route recording** - Record and replay navigation paths
- ⬜ **Statistics dashboard** - Show exploration stats

#### 12. Accessibility
- ⬜ **Screen reader support** - Improve accessibility for visually impaired
- ⬜ **Keyboard-only navigation** - Full functionality without mouse
- ⬜ **High contrast mode** - For users with vision difficulties

## Technical Improvements

### Performance
- ⬜ Optimize WebGPU shader pipelines
- ⬜ Implement texture streaming for better memory usage
- ⬜ Add performance monitoring and FPS counter

### Code Quality
- ⬜ Add comprehensive unit tests
- ⬜ Implement end-to-end testing
- ⬜ Add error boundary components
- ⬜ Improve TypeScript type coverage

### Infrastructure
- ⬜ Set up CI/CD pipeline
- ⬜ Add automated deployment
- ⬜ Implement feature flags for gradual rollouts

## Research Areas

1. **Machine Learning Integration**
   - Object detection in Street View images
   - Automatic scene description for accessibility
   - Intelligent route suggestions

2. **WebGPU Advancements**
   - Explore new WebGPU features as they become available
   - Investigate compute shader optimizations
   - Research advanced rendering techniques

3. **Mobile Optimization**
   - Touch gesture support
   - Mobile-specific UI/UX
   - Battery usage optimization

## Resources & References

- [Google Maps Platform Documentation](https://developers.google.com/maps/documentation)
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Street View Static API](https://developers.google.com/maps/documentation/streetview)
- [WebGPU Samples](https://webgpu.github.io/webgpu-samples/)

## Contributing

When implementing features from this plan:
1. Create a focused branch for the feature
2. Update this document to mark progress (⬜ → ✅)
3. Add tests for new functionality
4. Update AGENTS.md if new systems/agents are introduced
5. Document any new APIs or interfaces

---

*Last Updated: 2025-12-09*
