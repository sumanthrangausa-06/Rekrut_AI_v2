import { Check, Edit2, Plus, Save, Star, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SharedNote {
	id: number;
	candidate_id: number;
	author_id: number;
	content: string;
	rating: number | null;
	created_at: string;
	updated_at: string;
	author_name: string;
	author_avatar: string | null;
}

interface SharedNotesProps {
	candidateId: number;
	currentUserId: number;
}

function timeAgo(timestamp: string) {
	const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function StarRating({ rating }: { rating: number | null }) {
	if (!rating) return null;
	return (
		<div className="flex items-center gap-0.5">
			{[1, 2, 3, 4, 5].map((s) => (
				<Star
					key={s}
					className={cn(
						'h-4 w-4',
						s <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground',
					)}
				/>
			))}
		</div>
	);
}

export function SharedNotes({ candidateId, currentUserId }: SharedNotesProps) {
	const [notes, setNotes] = useState<SharedNote[]>([]);
	const [loading, setLoading] = useState(false);
	const [showForm, setShowForm] = useState(false);
	const [content, setContent] = useState('');
	const [rating, setRating] = useState<number | null>(null);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [editContent, setEditContent] = useState('');
	const [editRating, setEditRating] = useState<number | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await apiCall<{ notes: SharedNote[] }>(
				`/collaboration/notes?candidate_id=${candidateId}`,
			);
			setNotes(data.notes || []);
		} catch (err) {
			console.error('[SharedNotes] Load error:', err);
		} finally {
			setLoading(false);
		}
	}, [candidateId]);

	useEffect(() => {
		load();
	}, [load]);

	async function handleCreate() {
		if (!content.trim()) return;
		try {
			await apiCall('/collaboration/notes', {
				method: 'POST',
				body: { candidate_id: candidateId, content, rating },
			});
			setContent('');
			setRating(null);
			setShowForm(false);
			load();
		} catch (err) {
			console.error('[SharedNotes] Create error:', err);
		}
	}

	async function handleEdit(id: number) {
		if (!editContent.trim()) return;
		try {
			await apiCall(`/collaboration/notes/${id}`, {
				method: 'PUT',
				body: { content: editContent, rating: editRating },
			});
			setEditingId(null);
			load();
		} catch (err) {
			console.error('[SharedNotes] Edit error:', err);
		}
	}

	async function handleDelete(id: number) {
		try {
			await apiCall(`/collaboration/notes/${id}`, { method: 'DELETE' });
			load();
		} catch (err) {
			console.error('[SharedNotes] Delete error:', err);
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-foreground">Shared Notes</h3>
				<Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
					<Plus className="h-3 w-3 mr-1" />
					{showForm ? 'Cancel' : 'Add Note'}
				</Button>
			</div>

			{showForm && (
				<Card>
					<CardContent className="pt-4 space-y-3">
						<Textarea
							value={content}
							onChange={(e) => setContent(e.target.value)}
							placeholder="Write a shared note..."
							rows={3}
						/>
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Rating:</span>
							<div className="flex items-center gap-1">
								{[1, 2, 3, 4, 5].map((s) => (
									<button
										key={s}
										type="button"
										onClick={() => setRating(s === rating ? null : s)}
										className="focus:outline-none"
									>
										<Star
											className={cn(
												'h-5 w-5 transition-colors',
												s <= (rating || 0)
													? 'fill-amber-400 text-amber-400'
													: 'text-muted-foreground hover:text-amber-300',
											)}
										/>
									</button>
								))}
								{rating && (
									<button
										onClick={() => setRating(null)}
										className="text-xs text-muted-foreground ml-1"
									>
										Clear
									</button>
								)}
							</div>
						</div>
						<div className="flex justify-end">
							<Button size="sm" onClick={handleCreate} disabled={!content.trim()}>
								<Save className="h-3 w-3 mr-1" /> Save Note
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{loading ? (
				<div className="space-y-3">
					{[1, 2].map((i) => (
						<div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
					))}
				</div>
			) : notes.length === 0 ? (
				<div className="text-center py-6 text-muted-foreground text-sm">No shared notes yet.</div>
			) : (
				<div className="space-y-3">
					{notes.map((note) => {
						const isMine = note.author_id === currentUserId;
						const isEditing = editingId === note.id;

						return (
							<Card key={note.id} className="group">
								<CardContent className="pt-4">
									{isEditing ? (
										<div className="space-y-3">
											<Textarea
												value={editContent}
												onChange={(e) => setEditContent(e.target.value)}
												rows={3}
											/>
											<div className="flex items-center gap-2">
												<span className="text-sm text-muted-foreground">Rating:</span>
												{[1, 2, 3, 4, 5].map((s) => (
													<button
														key={s}
														type="button"
														onClick={() => setEditRating(s === editRating ? null : s)}
													>
														<Star
															className={cn(
																'h-4 w-4',
																s <= (editRating || 0)
																	? 'fill-amber-400 text-amber-400'
																	: 'text-muted-foreground',
															)}
														/>
													</button>
												))}
											</div>
											<div className="flex gap-2">
												<Button size="sm" onClick={() => handleEdit(note.id)}>
													<Check className="h-3 w-3 mr-1" /> Save
												</Button>
												<Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
													<X className="h-3 w-3 mr-1" /> Cancel
												</Button>
											</div>
										</div>
									) : (
										<>
											<div className="flex items-start justify-between">
												<div className="flex items-center gap-2">
													<Avatar
														src={note.author_avatar}
														fallback={note.author_name || '?'}
														size="sm"
														seed={note.author_id}
													/>
													<div>
														<div className="text-sm font-medium">{note.author_name}</div>
														<div className="text-xs text-muted-foreground">
															{timeAgo(note.created_at)}
															{note.updated_at !== note.created_at && ' (edited)'}
														</div>
													</div>
												</div>
												{isMine && (
													<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
														<Button
															variant="ghost"
															size="sm"
															className="h-7 w-7 p-0"
															onClick={() => {
																setEditingId(note.id);
																setEditContent(note.content);
																setEditRating(note.rating);
															}}
														>
															<Edit2 className="h-3 w-3" />
														</Button>
														<Button
															variant="ghost"
															size="sm"
															className="h-7 w-7 p-0 text-destructive"
															onClick={() => handleDelete(note.id)}
														>
															<Trash2 className="h-3 w-3" />
														</Button>
													</div>
												)}
											</div>
											<p className="text-sm mt-2 text-foreground">{note.content}</p>
											{note.rating && (
												<div className="mt-2">
													<StarRating rating={note.rating} />
												</div>
											)}
										</>
									)}
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}
