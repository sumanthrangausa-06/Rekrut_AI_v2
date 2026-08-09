import { useCallback, useRef, useState } from 'react'
import { Upload, X, ImageIcon, Crop, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SignatureUploaderProps {
	onChange?: (base64Png: string | null) => void
	className?: string
}

const MAX_WIDTH = 600
const MAX_HEIGHT = 200

export function SignatureUploader({ onChange, className }: SignatureUploaderProps) {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null)
	const [croppedUrl, setCroppedUrl] = useState<string | null>(null)
	const [isCropping, setIsCropping] = useState(false)
	const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 })
	const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
	const imgRef = useRef<HTMLImageElement>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const resizeAndExport = useCallback(
		(imageUrl: string): Promise<string> => {
			return new Promise((resolve, reject) => {
				const img = new Image()
				img.onload = () => {
					const canvas = document.createElement('canvas')
					let { width, height } = img

					// Scale down if too large
					if (width > MAX_WIDTH) {
						height = (height * MAX_WIDTH) / width
						width = MAX_WIDTH
					}
					if (height > MAX_HEIGHT) {
						width = (width * MAX_HEIGHT) / height
						height = MAX_HEIGHT
					}

					canvas.width = width
					canvas.height = height
					const ctx = canvas.getContext('2d')
					if (!ctx) {
						reject(new Error('Failed to get canvas context'))
						return
					}

					ctx.fillStyle = '#ffffff'
					ctx.fillRect(0, 0, width, height)
					ctx.drawImage(img, 0, 0, width, height)
					resolve(canvas.toDataURL('image/png'))
				}
				img.onerror = () => reject(new Error('Failed to load image'))
				img.src = imageUrl
			})
		},
		[],
	)

	const handleFileSelect = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0]
			if (!file) return

			if (!file.type.startsWith('image/')) {
				alert('Please select an image file')
				return
			}

			const reader = new FileReader()
			reader.onload = async (event) => {
				const url = event.target?.result as string
				if (!url) return
				setPreviewUrl(url)
				setCroppedUrl(null)
				setIsCropping(false)
				setCrop({ x: 0, y: 0, width: 0, height: 0 })

				// Auto-resize and export
				try {
					const resized = await resizeAndExport(url)
					setCroppedUrl(resized)
					onChange?.(resized)
				} catch {
					// Fallback to original
					setCroppedUrl(url)
					onChange?.(url)
				}
			}
			reader.readAsDataURL(file)
		},
		[onChange, resizeAndExport],
	)

	const handleClear = useCallback(() => {
		setPreviewUrl(null)
		setCroppedUrl(null)
		setIsCropping(false)
		setCrop({ x: 0, y: 0, width: 0, height: 0 })
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
		onChange?.(null)
	}, [onChange])

	const handleCropStart = useCallback(
		(e: React.MouseEvent | React.TouchEvent) => {
			if (!containerRef.current) return
			const rect = containerRef.current.getBoundingClientRect()
			let clientX: number, clientY: number
			if ('touches' in e) {
				clientX = e.touches[0].clientX
				clientY = e.touches[0].clientY
			} else {
				clientX = e.clientX
				clientY = e.clientY
			}
			const x = clientX - rect.left
			const y = clientY - rect.top
			setDragStart({ x, y })
			setCrop({ x, y, width: 0, height: 0 })
		},
		[],
	)

	const handleCropMove = useCallback(
		(e: React.MouseEvent | React.TouchEvent) => {
			if (!dragStart || !containerRef.current) return
			const rect = containerRef.current.getBoundingClientRect()
			let clientX: number, clientY: number
			if ('touches' in e) {
				clientX = e.touches[0].clientX
				clientY = e.touches[0].clientY
			} else {
				clientX = e.clientX
				clientY = e.clientY
			}
			const currentX = clientX - rect.left
			const currentY = clientY - rect.top
			setCrop({
				x: Math.min(dragStart.x, currentX),
				y: Math.min(dragStart.y, currentY),
				width: Math.abs(currentX - dragStart.x),
				height: Math.abs(currentY - dragStart.y),
			})
		},
		[dragStart],
	)

	const handleCropEnd = useCallback(() => {
		setDragStart(null)
	}, [])

	const applyCrop = useCallback(() => {
		if (!imgRef.current || crop.width < 10 || crop.height < 10) {
			setIsCropping(false)
			return
		}

		const img = imgRef.current
		const canvas = document.createElement('canvas')
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		// Calculate scale factor between displayed image and natural size
		const scaleX = img.naturalWidth / img.clientWidth
		const scaleY = img.naturalHeight / img.clientHeight

		const sourceX = crop.x * scaleX
		const sourceY = crop.y * scaleY
		const sourceWidth = crop.width * scaleX
		const sourceHeight = crop.height * scaleY

		canvas.width = Math.min(sourceWidth, MAX_WIDTH)
		canvas.height = Math.min(sourceHeight, MAX_HEIGHT)

		ctx.fillStyle = '#ffffff'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)

		const dataUrl = canvas.toDataURL('image/png')
		setCroppedUrl(dataUrl)
		setPreviewUrl(dataUrl)
		setIsCropping(false)
		setCrop({ x: 0, y: 0, width: 0, height: 0 })
		onChange?.(dataUrl)
	}, [crop, onChange])

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			{!previewUrl ? (
				<div className="relative">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/png,image/jpeg,image/jpg,image/webp"
						onChange={handleFileSelect}
						className="hidden"
					/>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						className="w-full h-48 sm:h-56 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 dark:bg-slate-900/50 flex flex-col items-center justify-center gap-3 hover:border-primary/50 hover:bg-primary/5 transition-colors"
					>
						<ImageIcon className="h-8 w-8 text-muted-foreground/50" />
						<span className="text-sm text-muted-foreground">Click to upload a signature image</span>
						<span className="text-xs text-muted-foreground/60">PNG, JPG, WEBP up to 5MB</span>
					</button>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<div
						ref={containerRef}
						className={cn(
							'relative rounded-lg border border-slate-200 bg-white dark:bg-slate-900 overflow-hidden',
							isCropping && 'cursor-crosshair',
						)}
						onMouseDown={isCropping ? handleCropStart : undefined}
						onMouseMove={isCropping ? handleCropMove : undefined}
						onMouseUp={isCropping ? handleCropEnd : undefined}
						onMouseLeave={isCropping ? handleCropEnd : undefined}
						onTouchStart={isCropping ? handleCropStart : undefined}
						onTouchMove={isCropping ? handleCropMove : undefined}
						onTouchEnd={isCropping ? handleCropEnd : undefined}
					>
						<img
							ref={imgRef}
							src={previewUrl}
							alt="Signature preview"
							className="w-full h-auto max-h-64 object-contain"
							draggable={false}
						/ />
						{isCropping && crop.width > 0 && crop.height > 0 && (
							<div
								className="absolute border-2 border-primary bg-primary/10"
								style={{
									left: crop.x,
									top: crop.y,
									width: crop.width,
									height: crop.height,
								}}
							/ />
						)}
					</div>

					<div className="flex items-center gap-2 flex-wrap">
						{isCropping ? (
							<>
								<Button
									type="button"
									variant="default"
									size="sm"
									onClick={applyCrop}
									className="gap-1.5"
								>
									<Check className="h-3.5 w-3.5" />
									Apply Crop
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										setIsCropping(false)
										setCrop({ x: 0, y: 0, width: 0, height: 0 })
									}}
								>
									Cancel
								</Button>
							</>
						) : (
							<>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										setIsCropping(true)
										setCrop({ x: 0, y: 0, width: 0, height: 0 })
									}}
									className="gap-1.5"
								>
									<Crop className="h-3.5 w-3.5" />
									Crop
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => fileInputRef.current?.click()}
									className="gap-1.5"
								>
									<Upload className="h-3.5 w-3.5" />
									Replace
								</Button>
							</>
						)}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleClear}
							className="gap-1.5 text-destructive hover:text-destructive"
						>
							<X className="h-3.5 w-3.5" />
							Remove
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
