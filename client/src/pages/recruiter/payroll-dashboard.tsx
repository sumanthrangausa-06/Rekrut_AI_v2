import { Navigate } from 'react-router-dom';

export function RecruiterPayrollDashboardPage() {
	return (
		<div className="px-4 md:px-6 lg:px-8 max-w-full">
			<Navigate to="/recruiter/payroll" replace />
		</div>
	);
}
