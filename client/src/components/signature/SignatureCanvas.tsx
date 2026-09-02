import { Eraser, Pen, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Point {
	x: number;
	y: number;
}

interface Stroke {
	points: Point[];
}

interface SignatureCanvasProps {
	onChange?: (base64Png: string | null) => void;
	className?: string;
}

export function SignatureCanvas({ onChange, className }: SignatureCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isDrawing, setIsDrawing] = useState(false);
	const [strokes, setStrokes] = useState<Stroke[]>([]);
	const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
	const [hasDrawn, setHasDrawn] = useState(false);

	// Resize canvas to container with device pixel ratio for crisp rendering
	useEffect(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container) return;

		const resize = () => {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.scale(dpr, dpr);
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				ctx.strokeStyle = '#1e293b';
				ctx.lineWidth = 2.5;
			}
		};

		resize();
		window.addEventListener('resize', resize);
		return () => window.removeEventListener('resize', resize);
	}, []);

	// Redraw all strokes when strokes array changes
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const rect = canvas.getBoundingClientRect();
		ctx.clearRect(0, 0, rect.width, rect.height);

		for (const stroke of strokes) {
			if (stroke.points.length < 2) continue;
			ctx.beginPath();
			ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
			for (let i = 1; i < stroke.points.length; i++) {
				ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
			}
			ctx.stroke();
		}

		// Also draw current stroke
		if (currentStroke.length >= 2) {
			ctx.beginPath();
			ctx.moveTo(currentStroke[0].x, currentStroke[0].y);
			for (let i = 1; i < currentStroke.length; i++) {
				ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
			}
			ctx.stroke();
		}
	}, [strokes, currentStroke]);

	// Export to base64 PNG
	const exportToPng = useCallback((): string | null => {
		const canvas = canvasRef.current;
		if (!canvas || strokes.length === 0) return null;

		// Create a new canvas with white background for export
		const exportCanvas = document.createElement('canvas');
		exportCanvas.width = canvas.width;
		exportCanvas.height = canvas.height;
		const ctx = exportCanvas.getContext('2d');
		if (!ctx) return null;

		// White background
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

		// Draw strokes
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = '#1e293b';
		ctx.lineWidth = 2.5 * (window.devicePixelRatio || 1);

		for (const stroke of strokes) {
			if (stroke.points.length < 2) continue;
			ctx.beginPath();
			ctx.moveTo(
				stroke.points[0].x * (window.devicePixelRatio || 1),
				stroke.points[0].y * (window.devicePixelRatio || 1),
			);
			for (let i = 1; i < stroke.points.length; i++) {
				ctx.lineTo(
					stroke.points[i].x * (window.devicePixelRatio || 1),
					stroke.points[i].y * (window.devicePixelRatio || 1),
				);
			}
			ctx.stroke();
		}

		return exportCanvas.toDataURL('image/png');
	}, [strokes]);

	// Notify parent on change
	useEffect(() => {
		if (!hasDrawn) {
			onChange?.(null);
			return;
		}
		const dataUrl = exportToPng();
		onChange?.(dataUrl);
	}, [hasDrawn, strokes, exportToPng, onChange]);

	const getPoint = useCallback((e: React.MouseEvent | React.TouchEvent): Point | null => {
		const canvas = canvasRef.current;
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();

		let clientX: number, clientY: number;
		if ('touches' in e) {
			clientX = e.touches[0].clientX;
			clientY = e.touches[0].clientY;
		} else {
			clientX = e.clientX;
			clientY = e.clientY;
		}

		return {
			x: clientX - rect.left,
			y: clientY - rect.top,
		};
	}, []);

	const handleStart = useCallback(
		(e: React.MouseEvent | React.TouchEvent) => {
			e.preventDefault();
			const point = getPoint(e);
			if (!point) return;
			setIsDrawing(true);
			setCurrentStroke([point]);
			setHasDrawn(true);
		},
		[getPoint],
	);

	const handleMove = useCallback(
		(e: React.MouseEvent | React.TouchEvent) => {
			if (!isDrawing) return;
			e.preventDefault();
			const point = getPoint(e);
			if (!point) return;
			setCurrentStroke((prev) => [...prev, point]);
		},
		[isDrawing, getPoint],
	);

	const handleEnd = useCallback(() => {
		if (!isDrawing) return;
		setIsDrawing(false);
		setStrokes((prev) => [...prev, { points: currentStroke }]);
		setCurrentStroke([]);
	}, [isDrawing, currentStroke]);

	const handleClear = useCallback(() => {
		setStrokes([]);
		setCurrentStroke([]);
		setHasDrawn(false);
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const rect = canvas.getBoundingClientRect();
		ctx.clearRect(0, 0, rect.width, rect.height);
	}, []);

	const handleUndo = useCallback(() => {
		setStrokes((prev) => {
			const next = prev.slice(0, -1);
			if (next.length === 0) {
				setHasDrawn(false);
			}
			return next;
		});
	}, []);

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<div
				ref={containerRef}
				className="relative w-full h-48 sm:h-56 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 dark:bg-slate-900/50 overflow-hidden touch-none"
			>
				<canvas
					ref={canvasRef}
					className="absolute inset-0 w-full h-full cursor-crosshair"
					onMouseDown={handleStart}
					onMouseMove={handleMove}
					onMouseUp={handleEnd}
					onMouseLeave={handleEnd}
					onTouchStart={handleStart}
					onTouchMove={handleMove}
					onTouchEnd={handleEnd}
				/>
				{!hasDrawn && (
					<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
						<div className="flex flex-col items-center gap-2 text-muted-foreground">
							<Pen className="h-6 w-6 opacity-40" />
							<span className="text-sm">Sign here using your mouse or finger</span>
						</div>
					</div>
				)}
			</div>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleUndo}
					disabled={strokes.length === 0}
					className="gap-1.5"
				>
					<RotateCcw className="h-3.5 w-3.5" />
					Undo
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={handleClear}
					disabled={!hasDrawn}
					className="gap-1.5"
				>
					<Eraser className="h-3.5 w-3.5" />
					Clear
				</Button>
			</div>
		</div>
	);
}
