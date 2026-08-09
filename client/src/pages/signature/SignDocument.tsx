import { useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SigningCeremony } from '@/components/signature/SigningCeremony'

export function SignDocumentPage() {
	const { documentId, requestId } = useParams<{ documentId: string; requestId: string }>()

	const docId = documentId ? Number.parseInt(documentId, 10) : NaN
	const reqId = requestId ? Number.parseInt(requestId, 10) : NaN

	if (Number.isNaN(docId) || Number.isNaN(reqId)) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center px-4">
				<Card className="max-w-md w-full">
					<CardHeader className="text-center">
						<div className="mx-auto h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
							<AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
						</div>
						<CardTitle className="text-xl">Invalid Link</CardTitle>
						<CardDescription>
							The signing link you followed appears to be invalid or incomplete.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button className="w-full" onClick={() => (window.location.href = '/candidate/documents')}>
							Go to Documents
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return <SigningCeremony documentId={docId} requestId={reqId} />
}

export default SignDocumentPage
