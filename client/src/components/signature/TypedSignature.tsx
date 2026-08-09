import { useCallback, useEffect, useRef, useState } from 'react'
import { Type, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface TypedSignatureProps {
	onChange?: (base64Png: string | null) => void
	className?: string
}

const FONT_OPTIONS = [
	{
		name: 'Cursive',
		value: "'Brush Script MT', 'Segoe Script', cursive",
		display: 'Brush Script',
	},
	{
		name: 'Script',
		value: "'Georgia', 'Times New Roman', serif",
		display: 'Georgia',
	},
	{
		name: 'Elegant',
		value: "'Palatino Linotype', 'Book Antiqua', serif",
		display: 'Palatino',
	},
	{
		name: 'Modern',
		value: "'Inter', 'Helvetica Neue', sans-serif",
		display: 'Inter',
	},
]

export function TypedSignature({ onChange, className }: TypedSignatureProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [text, setText] = useState('')
	const [selectedFont, setSelectedFont] = useState(FONT_OPTIONS[0].value)
	const [fontName, setFontName] = useState(FONT_OPTIONS[0].name)

	const renderToCanvas = useCallback(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		const dpr = window.devicePixelRatio || 1
		const width = 600
		const height = 200
		canvas.width = width * dpr
		canvas.height = height * dpr
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
		ctx.scale(dpr, dpr)

		// White background
		ctx.fillStyle = '#ffffff'
		ctx.fillRect(0, 0, width, height)

		if (!text.trim()) {
			onChange?.(null)
			return
		}

		// Draw signature line
		ctx.strokeStyle = '#94a3b8'
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(40, 140)
		ctx.lineTo(560, 140)
		ctx.stroke()

		// Draw text
		ctx.font = `italic 48px ${selectedFont}`
		ctx.fillStyle = '#1e293b'
		ctx.textBaseline = 'alphabetic'
		ctx.textAlign = 'center'

		const x = width / 2
		const y = 120

		ctx.fillText(text, x, y)

		// Export
		const dataUrl = canvas.toDataURL('image/png')
		onChange?.(dataUrl)
	}, [text, selectedFont, onChange])

	useEffect(() => {
		renderToCanvas()
	}, [renderToCanvas])

	const cycleFont = useCallback(() => {
		const currentIndex = FONT_OPTIONS.findIndex((f) => f.value === selectedFont)
		const nextIndex = (currentIndex + 1) % FONT_OPTIONS.length
		setSelectedFont(FONT_OPTIONS[nextIndex].value)
		setFontName(FONT_OPTIONS[nextIndex].name)
	}, [selectedFont])

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<div className="space-y-2">
				<Label htmlFor="signature-text">
					<Type className="h-3.5 w-3.5 inline mr-1.5" />
					Type your full legal name
				</Label>
				<Input
					id="signature-text"
					type="text"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder="e.g. John A. Smith"
					className="text-base"
					autoComplete="name"
				/>
			</div>

			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={cycleFont}
					className="gap-1.5"
				>
					<RefreshCw className="h-3.5 w-3.5" />
					Change Style: {fontName}
				</Button>
			</div>

			<div className="rounded-lg border border-slate-200 bg-white dark:bg-slate-900 overflow-hidden flex items-center justify-center py-4">
				<canvas
					ref={canvasRef}
					className="max-w-full h-auto"
					style={{ maxWidth: '100%', height: 'auto' }}
				/>
			</div>

			{!text.trim() && (
				<p className="text-xs text-muted-foreground text-center">
					Type your name above to see a preview of your typed signature
				</p>
			)}
		</div>
	)
}
