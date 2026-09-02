import { ArrowLeft, Brain, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';

interface AptitudeTest {
	id: number;
	title: string;
	description: string | null;
	duration_minutes: number;
	question_count: number;
	pass_score: number;
	retake_lockout_days: number;
	is_active: boolean;
}

export function RecruiterAptitudeTestCreatePage() {
	const { id: editId } = useParams();
	const navigate = useNavigate();
	const isEdit = !!editId;

	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [durationMinutes, setDurationMinutes] = useState(30);
	const [questionCount, setQuestionCount] = useState(50);
	const [passScore, setPassScore] = useState(60);
	const [retakeLockoutDays, setRetakeLockoutDays] = useState(30);
	const [isActive, setIsActive] = useState(true);
	const [saving, setSaving] = useState(false);
	const [loading, setLoading] = useState(false);

	const loadTest = useCallback(async () => {
		if (!editId) return;
		setLoading(true);
		try {
			const data = await apiCall<{ test: AptitudeTest }>(`/recruiter/aptitude-tests/${editId}`);
			const t = data.test;
			setTitle(t.title || '');
			setDescription(t.description || '');
			setDurationMinutes(t.duration_minutes || 30);
			setQuestionCount(t.question_count || 50);
			setPassScore(t.pass_score || 60);
			setRetakeLockoutDays(t.retake_lockout_days ?? 30);
			setIsActive(t.is_active);
		} catch {
			// Endpoint may not exist; leave form empty for manual fill
		}
		setLoading(false);
	}, [editId]);

	useEffect(() => {
		if (isEdit) loadTest();
	}, [isEdit, loadTest]);

	async function handleSave() {
		if (!title.trim()) {
			alert('Title is required');
			return;
		}
		setSaving(true);
		try {
			const payload = {
				title: title.trim(),
				description: description.trim() || null,
				durationMinutes,
				passScore,
				retakeLockoutDays,
				questionCount,
				is_active: isActive,
			};

			if (isEdit) {
				await apiCall(`/recruiter/aptitude-tests/${editId}`, {
					method: 'PUT',
					body: payload,
				});
			} else {
				await apiCall('/recruiter/aptitude-tests', {
					method: 'POST',
					body: payload,
				});
			}
			navigate('/recruiter/aptitude-tests');
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to save test';
			alert(msg);
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
				<div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<p className="text-muted-foreground">Loading test...</p>
			</div>
		);
	}

	return (
		<div className="max-w-3xl mx-auto space-y-6">
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					className="gap-1"
					onClick={() => navigate('/recruiter/aptitude-tests')}
				>
					<ArrowLeft className="h-4 w-4" /> Back
				</Button>
			</div>

			<div>
				<h1 className="font-heading text-2xl font-bold">
					{isEdit ? 'Edit Aptitude Test' : 'Create Aptitude Test'}
				</h1>
				<p className="text-muted-foreground">
					{isEdit
						? 'Update test settings and review questions'
						: 'Set up a new cognitive assessment'}
				</p>
			</div>

			{/* Form */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Test Settings</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div>
						<Label htmlFor="title">Title *</Label>
						<Input
							id="title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="e.g., General Cognitive Ability Test"
						/>
					</div>

					<div>
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Brief description of what this test assesses..."
							rows={3}
						/>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
						<div>
							<Label htmlFor="duration">Duration (minutes)</Label>
							<Input
								id="duration"
								type="number"
								min={5}
								max={180}
								value={durationMinutes}
								onChange={(e) => setDurationMinutes(Number(e.target.value))}
							/>
						</div>
						<div>
							<Label htmlFor="questionCount">Question Count</Label>
							<Input
								id="questionCount"
								type="number"
								min={5}
								max={100}
								value={questionCount}
								onChange={(e) => setQuestionCount(Number(e.target.value))}
							/>
						</div>
						<div>
							<Label htmlFor="passScore">Pass Score (%)</Label>
							<Input
								id="passScore"
								type="number"
								min={0}
								max={100}
								value={passScore}
								onChange={(e) => setPassScore(Number(e.target.value))}
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<Label htmlFor="retake">Retake Lockout (days)</Label>
							<Input
								id="retake"
								type="number"
								min={0}
								max={365}
								value={retakeLockoutDays}
								onChange={(e) => setRetakeLockoutDays(Number(e.target.value))}
							/>
						</div>
						<div className="flex items-end">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={isActive}
									onChange={(e) => setIsActive(e.target.checked)}
									className="h-4 w-4 rounded border-gray-300"
								/>
								<span className="text-sm">Active</span>
							</label>
						</div>
					</div>
				</CardContent>
			</Card>

			{isEdit && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Question Bank</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-center py-6 text-sm text-muted-foreground">
							<Brain className="mx-auto h-8 w-8 mb-2 opacity-50" />
							<p>Questions are seeded via database migration and managed separately.</p>
							<p className="text-xs mt-1">
								Use the API or database directly to manage question content.
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Target Score Per Role */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Target Score Range by Role</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Target score ranges can be configured when assigning this test to specific jobs. Go to
						any job posting → Assign Aptitude Test to set role-specific score requirements.
					</p>
					{isEdit && (
						<div className="mt-3">
							<Button variant="outline" size="sm" onClick={() => navigate('/recruiter/jobs')}>
								Go to Jobs →
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Actions */}
			<div className="flex justify-end gap-3">
				<Button
					variant="outline"
					onClick={() => navigate('/recruiter/aptitude-tests')}
					disabled={saving}
				>
					Cancel
				</Button>
				<Button onClick={handleSave} disabled={saving} className="gap-1 min-h-[44px]">
					{saving ? (
						<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
					) : (
						<Save className="h-4 w-4" />
					)}
					{isEdit ? 'Update Test' : 'Create Test'}
				</Button>
			</div>
		</div>
	);
}
