import DOMPurify from 'dompurify';
import { useEffect, useRef } from 'react';

/**
 * SafeHtml - Renders sanitized HTML without using dangerouslySetInnerHTML.
 *
 * Uses a ref + useEffect to set innerHTML imperatively after DOMPurify sanitization.
 * This avoids the React dangerouslySetInnerHTML anti-pattern while maintaining
 * the same security posture (DOMPurify strips scripts, event handlers, etc.).
 */
interface SafeHtmlProps {
	html: string;
	className?: string;
}

export function SafeHtml({ html, className }: SafeHtmlProps) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (ref.current) {
			ref.current.innerHTML = DOMPurify.sanitize(html);
		}
	}, [html]);

	return <div ref={ref} className={className} />;
}
