import {
	AlertTriangle,
	CheckCircle,
	Eye,
	File,
	FileImage,
	FileSpreadsheet,
	FileText,
	Loader2,
	Upload,
	X,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';

export type UploadFile = {
	id: string;
	name: string;
	size: number;
	type: string;
	progress: number;
	status: 'uploading' | 'processing' | 'completed' | 'error';
	previewUrl?: string;
	ocrText?: string;
	ocrConfidence?: number;
	fraudScore?: number;
	documentScore?: number;
	error?: string;
};

export type FileUploadProps = {
	accept?: string;
	maxSize?: number; // bytes
	maxFiles?: number;
	className?: string;
	onUpload?: (files: File[]) => Promise<void>;
	onRemove?: (id: string) => void;
	onPreview?: (file: UploadFile) => void;
	files?: UploadFile[];
	showOcr?: boolean;
	showFraud?: boolean;
	showScore?: boolean;
};

const typeIcons: Record<string, React.ReactNode> = {
	'application/pdf': <FileText className="h-5 w-5" />,
	'image/': <FileImage className="h-5 w-5" />,
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (
		<FileSpreadsheet className="h-5 w-5" />
	),
	'application/vnd.ms-excel': <FileSpreadsheet className="h-5 w-5" />,
};

function getTypeIcon(type: string): React.ReactNode {
	for (const [prefix, icon] of Object.entries(typeIcons)) {
		if (type.startsWith(prefix)) return icon;
	}
	return <File className="h-5 w-5" />;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function FileUpload({
	accept = '.pdf,.doc,.docx,.png,.jpg,.jpeg',
	maxSize = 10 * 1024 * 1024, // 10MB
	maxFiles = 5,
	className,
	onUpload,
	onRemove,
	onPreview,
	files = [],
	showOcr = true,
	showFraud = true,
	showScore = true,
}: FileUploadProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [internalFiles, setInternalFiles] = useState<UploadFile[]>(files);

	const allFiles = files.length > 0 ? files : internalFiles;

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault();
			setIsDragging(false);

			const droppedFiles = Array.from(e.dataTransfer.files);
			if (droppedFiles.length === 0) return;

			const validFiles = droppedFiles.filter((f) => {
				if (f.size > maxSize) {
					alert(`${f.name} exceeds ${formatBytes(maxSize)} limit`);
					return false;
				}
				return true;
			});

			if (allFiles.length + validFiles.length > maxFiles) {
				alert(`Maximum ${maxFiles} files allowed`);
				return;
			}

			trackEvent('file_upload_dropped', { count: validFiles.length });

			if (onUpload) {
				await onUpload(validFiles);
			} else {
				// Simulate upload
				const newFiles: UploadFile[] = validFiles.map((f) => ({
					id: Math.random().toString(36).slice(2),
					name: f.name,
					size: f.size,
					type: f.type,
					progress: 0,
					status: 'uploading',
				}));
				setInternalFiles((prev) => [...prev, ...newFiles]);

				// Simulate progress
				newFiles.forEach((file) => {
					const interval = setInterval(() => {
						setInternalFiles((prev) =>
							prev.map((f) =>
								f.id === file.id
									? {
											...f,
											progress: Math.min(f.progress + 20, 100),
											status: f.progress >= 80 ? 'processing' : 'uploading',
										}
									: f,
							),
						);
					}, 300);

					setTimeout(() => {
						clearInterval(interval);
						setInternalFiles((prev) =>
							prev.map((f) =>
								f.id === file.id
									? {
											...f,
											progress: 100,
											status: 'completed',
											ocrText: 'OCR text extracted...',
											ocrConfidence: 0.92,
											documentScore: 85,
											fraudScore: 0.1,
										}
									: f,
							),
						);
					}, 2000);
				});
			}
		},
		[allFiles.length, maxFiles, maxSize, onUpload],
	);

	const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFiles = Array.from(e.target.files || []);
		if (selectedFiles.length === 0) return;

		const validFiles = selectedFiles.filter((f) => {
			if (f.size > maxSize) {
				alert(`${f.name} exceeds ${formatBytes(maxSize)} limit`);
				return false;
			}
			return true;
		});

		if (allFiles.length + validFiles.length > maxFiles) {
			alert(`Maximum ${maxFiles} files allowed`);
			return;
		}

		trackEvent('file_upload_selected', { count: validFiles.length });

		if (onUpload) {
			await onUpload(validFiles);
		} else {
			const newFiles: UploadFile[] = validFiles.map((f) => ({
				id: Math.random().toString(36).slice(2),
				name: f.name,
				size: f.size,
				type: f.type,
				progress: 0,
				status: 'uploading',
			}));
			setInternalFiles((prev) => [...prev, ...newFiles]);

			newFiles.forEach((file) => {
				const interval = setInterval(() => {
					setInternalFiles((prev) =>
						prev.map((f) =>
							f.id === file.id
								? {
										...f,
										progress: Math.min(f.progress + 25, 100),
										status: f.progress >= 75 ? 'processing' : 'uploading',
									}
								: f,
						),
					);
				}, 250);

				setTimeout(() => {
					clearInterval(interval);
					setInternalFiles((prev) =>
						prev.map((f) =>
							f.id === file.id
								? {
										...f,
										progress: 100,
										status: 'completed',
										ocrText: 'Document text extracted successfully...',
										ocrConfidence: 0.89,
										documentScore: 78,
										fraudScore: 0.05,
									}
								: f,
						),
					);
				}, 1500);
			});
		}
	};

	const handleRemove = (id: string) => {
		if (onRemove) {
			onRemove(id);
		} else {
			setInternalFiles((prev) => prev.filter((f) => f.id !== id));
		}
		trackEvent('file_remove', { file_id: id });
	};

	return (
		<div className={cn('space-y-4', className)}>
			{/* Drop zone */}
			<div
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				className={cn(
					'relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
					isDragging
						? 'border-primary bg-primary/5'
						: 'border-muted-foreground/25 hover:border-muted-foreground/50',
				)}
			>
				<input
					type="file"
					multiple
					accept={accept}
					onChange={handleFileInput}
					className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
				/>
				<div className="flex flex-col items-center gap-2">
					<Upload className="h-8 w-8 text-muted-foreground" />
					<p className="text-sm font-medium">Drop files here or click to upload</p>
					<p className="text-xs text-muted-foreground">
						{accept.replace(/\./g, '').toUpperCase()} up to {formatBytes(maxSize)} each
					</p>
					<p className="text-xs text-muted-foreground">Max {maxFiles} files</p>
				</div>
			</div>

			{/* File list */}
			{allFiles.length > 0 && (
				<div className="space-y-3">
					{allFiles.map((file) => (
						<div key={file.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
							<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
								{getTypeIcon(file.type)}
							</div>

							<div className="flex-1 min-w-0 space-y-1">
								<div className="flex items-center justify-between">
									<p className="text-sm font-medium truncate">{file.name}</p>
									<div className="flex items-center gap-1 shrink-0">
										{file.status === 'completed' && onPreview && (
											<Button
												variant="ghost"
												size="sm"
												className="h-7 w-7 p-0"
												onClick={() => onPreview(file)}
											>
												<Eye className="h-3.5 w-3.5" />
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0 text-destructive"
											onClick={() => handleRemove(file.id)}
										>
											<X className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>

								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<span>{formatBytes(file.size)}</span>
									{file.status === 'uploading' && (
										<span className="flex items-center gap-1">
											<Loader2 className="h-3 w-3 animate-spin" />
											Uploading...
										</span>
									)}
									{file.status === 'processing' && (
										<span className="flex items-center gap-1">
											<Loader2 className="h-3 w-3 animate-spin" />
											Processing...
										</span>
									)}
									{file.status === 'completed' && (
										<span className="flex items-center gap-1 text-green-600">
											<CheckCircle className="h-3 w-3" />
											Done
										</span>
									)}
									{file.status === 'error' && (
										<span className="flex items-center gap-1 text-red-600">
											<AlertTriangle className="h-3 w-3" />
											{file.error || 'Error'}
										</span>
									)}
								</div>

								{/* Progress bar */}
								{file.status === 'uploading' || file.status === 'processing' ? (
									<Progress value={file.progress} className="h-1.5" />
								) : null}

								{/* OCR preview */}
								{showOcr && file.ocrText && file.ocrConfidence != null && (
									<div className="mt-2 p-2 rounded bg-muted/50 text-xs">
										<div className="flex items-center gap-1 mb-1 text-muted-foreground">
											<FileText className="h-3 w-3" />
											<span>OCR Preview</span>
											<span className="ml-auto">
												Confidence: {Math.round(file.ocrConfidence * 100)}%
											</span>
										</div>
										<p className="line-clamp-2 text-muted-foreground">{file.ocrText}</p>
									</div>
								)}

								{/* Fraud alert */}
								{showFraud && file.fraudScore != null && file.fraudScore > 0.7 && (
									<div className="flex items-center gap-1 text-xs text-red-600">
										<AlertTriangle className="h-3 w-3" />
										<span>Fraud risk detected ({Math.round(file.fraudScore * 100)}%)</span>
									</div>
								)}

								{/* Document score */}
								{showScore && file.documentScore != null && (
									<div className="flex items-center gap-2 text-xs">
										<span className="text-muted-foreground">Score impact:</span>
										<Progress value={file.documentScore} className="h-1.5 flex-1 max-w-[100px]" />
										<span className="font-medium">{file.documentScore}/100</span>
									</div>
								)}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
