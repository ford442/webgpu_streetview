import React, { useRef, useEffect } from 'react';

interface MiniMapProps {
    panX: number;
    panY: number;
    setPanX: (x: number) => void;
    setPanY: (y: number) => void;
    imageUrl?: string;
}

const MiniMap: React.FC<MiniMapProps> = ({ panX, panY, setPanX, setPanY, imageUrl }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw grid
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) {
            const x = (i / 10) * canvas.width;
            const y = (i / 10) * canvas.height;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Draw current position indicator
        const x = panX * canvas.width;
        const y = panY * canvas.height;
        
        // Draw viewing direction indicator
        ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#0f0';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        // Draw border
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
    }, [panX, panY, imageUrl]);

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / canvas.width;
        const y = (e.clientY - rect.top) / canvas.height;

        setPanX(x);
        setPanY(y);
    };

    return (
        <div className="minimap-container" style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            border: '2px solid #666',
            borderRadius: '8px',
            background: '#1a1a1a',
            padding: '10px',
            boxShadow: '0 4px 8px rgba(0,0,0,0.5)',
            zIndex: 1000
        }}>
            <div style={{ marginBottom: '5px', color: '#ccc', fontSize: '12px', fontWeight: 'bold' }}>
                Top-Down Map
            </div>
            <canvas
                ref={canvasRef}
                width={200}
                height={200}
                onClick={handleClick}
                style={{ cursor: 'crosshair', display: 'block' }}
            />
            <div style={{ marginTop: '5px', color: '#999', fontSize: '10px' }}>
                Click to navigate
            </div>
        </div>
    );
};

export default MiniMap;
