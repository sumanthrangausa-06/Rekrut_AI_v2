import { Navigate } from 'react-router-dom';

export function RecruiterRegisterPage() {
	return <Navigate to="/register?role=recruiter" replace />;
}
