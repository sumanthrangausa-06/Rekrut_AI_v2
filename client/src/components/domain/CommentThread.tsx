import { Check, CornerDownRight, Edit2, MessageCircle, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Comment {
	id: number;
	entity_type: string;
	entity_id: number;
	parent_id: number | null;
	author_id: number;
	content: string;
	deleted: boolean;
	created_at: string;
	updated_at: string;
	author_name: string;
	author_avatar: string | null;
	replies: Comment[];
}

interface CommentThreadProps {
	entityType: 'candidate' | 'application';
	entityId: number;
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

function MentionHighlight({ text }: { text: string }) {
	const parts = text.split(/(@\w+)/g);
	return (
		<>
			{parts.map((part, i) =>
				/^@\w+/.test(part) ? (
					<span key={i} className="text-primary font-semibold">
						{part}
					</span>
				) : (
					<span key={i}>{part}</span>
				),
			)}
		</>
	);
}

export function CommentThread({ entityType, entityId, currentUserId }: CommentThreadProps) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [loading, setLoading] = useState(false);
	const [newComment, setNewComment] = useState('');
	const [replyTo, setReplyTo] = useState<number | null>(null);
	const [replyText, setReplyText] = useState('');
	const [editingId, setEditingId] = useState<number | null>(null);
	const [editText, setEditText] = useState('');

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await apiCall<{ comments: Comment[] }>(
				`/collaboration/comments?entity_type=${entityType}&entity_id=${entityId}`,
			);
			setComments(data.comments || []);
		} catch (err) {
			console.error('[CommentThread] Load error:', err);
		} finally {
			setLoading(false);
		}
	}, [entityType, entityId]);

	useEffect(() => {
		load();
	}, [load]);

	async function handlePost() {
		if (!newComment.trim()) return;
		try {
			await apiCall('/collaboration/comments', {
				method: 'POST',
				body: { entity_type: entityType, entity_id: entityId, content: newComment },
			});
			setNewComment('');
			load();
		} catch (err) {
			console.error('[CommentThread] Post error:', err);
		}
	}

	async function handleReply(parentId: number) {
		if (!replyText.trim()) return;
		try {
			await apiCall('/collaboration/comments', {
				method: 'POST',
				body: {
					entity_type: entityType,
					entity_id: entityId,
					parent_id: parentId,
					content: replyText,
				},
			});
			setReplyText('');
			setReplyTo(null);
			load();
		} catch (err) {
			console.error('[CommentThread] Reply error:', err);
		}
	}

	async function handleEdit(id: number) {
		if (!editText.trim()) return;
		try {
			await apiCall(`/collaboration/comments/${id}`, {
				method: 'PUT',
				body: { content: editText },
			});
			setEditingId(null);
			load();
		} catch (err) {
			console.error('[CommentThread] Edit error:', err);
		}
	}

	async function handleDelete(id: number) {
		try {
			await apiCall(`/collaboration/comments/${id}`, { method: 'DELETE' });
			load();
		} catch (err) {
			console.error('[CommentThread] Delete error:', err);
		}
	}

	function renderComment(c: Comment, isReply = false) {
		const isMine = c.author_id === currentUserId;
		const isEditing = editingId === c.id;

		return (
			<div key={c.id} className={cn('group', isReply ? 'ml-10 mt-2' : 'mt-3')}>
				<div className="flex gap-3">
					<Avatar
						src={c.author_avatar}
						fallback={c.author_name || '?'}
						size="sm"
						seed={c.author_id}
					/>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium">{c.author_name || 'Unknown'}</span>
							<span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
							{c.updated_at !== c.created_at && (
								<span className="text-xs text-muted-foreground">(edited)</span>
							)}
						</div>

						{isEditing ? (
							<div className="mt-1 space-y-2">
								<Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} />
								<div className="flex gap-2">
									<Button size="sm" onClick={() => handleEdit(c.id)}>
										<Check className="h-3 w-3 mr-1" /> Save
									</Button>
									<Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
										<X className="h-3 w-3 mr-1" /> Cancel
									</Button>
								</div>
							</div>
						) : (
							<div className="text-sm mt-0.5 text-foreground">
								{c.deleted ? (
									<span className="text-muted-foreground italic">[deleted]</span>
								) : (
									<MentionHighlight text={c.content} />
								)}
							</div>
						)}

						{!c.deleted && !isEditing && (
							<div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-xs"
									onClick={() => {
										setReplyTo(c.id);
										setReplyText('');
									}}
								>
									<MessageCircle className="h-3 w-3 mr-1" /> Reply
								</Button>
								{isMine && (
									<>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-xs"
											onClick={() => {
												setEditingId(c.id);
												setEditText(c.content);
											}}
										>
											<Edit2 className="h-3 w-3 mr-1" /> Edit
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-xs text-destructive"
											onClick={() => handleDelete(c.id)}
										>
											<Trash2 className="h-3 w-3 mr-1" /> Delete
										</Button>
									</>
								)}
							</div>
						)}

						{replyTo === c.id && (
							<div className="mt-2 flex gap-2">
								<CornerDownRight className="h-4 w-4 text-muted-foreground mt-2 shrink-0" />
								<div className="flex-1 space-y-2">
									<Textarea
										value={replyText}
										onChange={(e) => setReplyText(e.target.value)}
										placeholder="Write a reply..."
										rows={2}
									/>
									<div className="flex gap-2">
										<Button size="sm" onClick={() => handleReply(c.id)}>
											<Send className="h-3 w-3 mr-1" /> Reply
										</Button>
										<Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
											Cancel
										</Button>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
				{c.replies?.map((r) => renderComment(r, true))}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex gap-3">
				<div className="flex-1 space-y-2">
					<Textarea
						value={newComment}
						onChange={(e) => setNewComment(e.target.value)}
						placeholder="Add a comment... Use @username to mention someone"
						rows={3}
					/>
					<div className="flex justify-end">
						<Button onClick={handlePost} disabled={!newComment.trim()}>
							<Send className="h-4 w-4 mr-2" /> Post Comment
						</Button>
					</div>
				</div>
			</div>

			{loading ? (
				<div className="space-y-3">
					{[1, 2].map((i) => (
						<div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
					))}
				</div>
			) : comments.length === 0 ? (
				<div className="text-center py-6 text-muted-foreground text-sm">
					No comments yet. Start the conversation!
				</div>
			) : (
				<div className="space-y-1">{comments.map((c) => renderComment(c))}</div>
			)}
		</div>
	);
}
