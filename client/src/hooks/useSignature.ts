import { useCallback, useState } from 'react';
import { apiCall } from '@/lib/api';

export interface SignatureDocument {
	id: number;
	company_id: number;
	created_by: number;
	title: string;
	description: string | null;
	document_type: string;
	file_url: string | null;
	file_size: number | null;
	mime_type: string | null;
	original_filename: string | null;
	document_hash: string;
	signature_type: string;
	status: string;
	expires_at: string | null;
	legal_jurisdiction: string;
	compliance_framework: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	cancelled_at: string | null;
	cancellation_reason: string | null;
	signers: SignatureSigner[];
}

export interface SignatureSigner {
	id: number;
	document_id: number;
	party_id: number;
	signing_order: number;
	status: string;
	sent_at: string | null;
	viewed_at: string | null;
	signed_at: string | null;
	declined_at: string | null;
	decline_reason: string | null;
	signature_value: string | null;
	signature_hash: string | null;
	signed_document_hash: string | null;
	signature_metadata: Record<string, unknown> | null;
	reminder_count: number;
	last_reminder_at: string | null;
	created_at: string;
	updated_at: string;
	email: string;
	full_name: string;
	phone: string | null;
	job_title: string | null;
	party_role: string;
	auth_method: string;
}

export interface SignResponse {
	success: boolean;
	request: SignatureSigner;
	hashRecord: Record<string, unknown>;
	message: string;
}

export interface DeclineResponse {
	success: boolean;
	request: SignatureSigner;
	message: string;
}

export function useSignature() {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const getDocument = useCallback(async (documentId: number): Promise<SignatureDocument | null> => {
		setLoading(true);
		setError(null);
		try {
			const data = await apiCall<{ success: boolean; document: SignatureDocument }>(
				`/signatures/documents/${documentId}`,
			);
			return data.document;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load document';
			setError(message);
			return null;
		} finally {
			setLoading(false);
		}
	}, []);

	const recordView = useCallback(async (requestId: number): Promise<boolean> => {
		try {
			await apiCall<{ success: boolean }>(`/signatures/requests/${requestId}/view`, {
				method: 'POST',
			});
			return true;
		} catch (err) {
			console.error('[useSignature] recordView error:', err);
			return false;
		}
	}, []);

	const sign = useCallback(
		async (
			requestId: number,
			signatureType: string,
			signatureValue: string,
			signatureMetadata?: Record<string, unknown>,
		): Promise<SignResponse | null> => {
			setLoading(true);
			setError(null);
			try {
				const data = await apiCall<SignResponse>(`/signatures/requests/${requestId}/sign`, {
					method: 'POST',
					body: {
						signature_type: signatureType,
						signature_value: signatureValue,
						signature_metadata: signatureMetadata || {},
					},
				});
				return data;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to submit signature';
				setError(message);
				return null;
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	const decline = useCallback(
		async (requestId: number, reason?: string): Promise<DeclineResponse | null> => {
			setLoading(true);
			setError(null);
			try {
				const data = await apiCall<DeclineResponse>(`/signatures/requests/${requestId}/decline`, {
					method: 'POST',
					body: { reason: reason || null },
				});
				return data;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to decline signature';
				setError(message);
				return null;
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	return {
		loading,
		error,
		clearError,
		getDocument,
		recordView,
		sign,
		decline,
	};
}
