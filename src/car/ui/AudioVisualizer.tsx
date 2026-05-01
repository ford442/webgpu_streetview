import React, { useEffect, useRef, useCallback } from 'react';

export interface AudioVisualizerProps {
  analyser?: AnalyserNode | null;
  isActive?: boolean;
  barCount?: number;
  width?: number;
  height?: number;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = React.memo(
  ({
    analyser,
    isActive = true,
    barCount = 20,
    width = 200,
    height = 40,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const dataRef = useRef<Uint8Array | null>(null);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);

      if (!isActive || !analyser) {
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        const barW = width / barCount - 2;
        for (let i = 0; i < barCount; i++) {
          const x = i * (barW + 2);
          ctx.fillRect(x, height - 2, barW, 2);
        }
        animationRef.current = requestAnimationFrame(draw);
        return;
      }

      if (!dataRef.current) dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataRef.current);
      const data = dataRef.current;
      const step = Math.floor(data.length / barCount);
      const barW = width / barCount - 2;

      for (let i = 0; i < barCount; i++) {
        const v = data[i * step] / 255;
        const h = Math.max(2, v * (height - 4));
        const x = i * (barW + 2);
        const y = height - h;

        const grad = ctx.createLinearGradient(0, height, 0, y);
        grad.addColorStop(0, '#0099CC');
        grad.addColorStop(1, '#00D4FF');
        ctx.fillStyle = grad;
        ctx.beginPath();
        (ctx as any).roundRect(x, y, barW, h, 3);
        ctx.fill();

        if (v > 0.3) {
          ctx.shadowColor = '#00D4FF';
          ctx.shadowBlur = 10 * v;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    }, [analyser, isActive, barCount, width, height]);

    useEffect(() => {
      animationRef.current = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(animationRef.current);
    }, [draw]);

    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          borderRadius: 4,
          background: 'rgba(0,0,0,0.3)',
        }}
        aria-label="Audio visualizer"
      />
    );
  }
);
