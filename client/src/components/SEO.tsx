import { Helmet } from 'react-helmet-async'

interface SEOProps {
	title: string
	description: string
	canonical?: string
	ogImage?: string
	ogType?: string
	noindex?: boolean
	jsonLd?: Record<string, unknown>
}

const SITE_URL = 'https://rekrutai.co'
const DEFAULT_OG_IMAGE = '/og-image.png'

export function SEO({
	title,
	description,
	canonical,
	ogImage = DEFAULT_OG_IMAGE,
	ogType = 'website',
	noindex = false,
	jsonLd,
}: SEOProps) {
	const fullTitle = title.includes('Rekrut AI') ? title : `${title} — Rekrut AI`
	const canonicalUrl = canonical ? `${SITE_URL}${canonical}` : undefined
	const ogImageUrl = ogImage.startsWith('http') ? ogImage : `${SITE_URL}${ogImage}`

	return (
		<Helmet>
			<title>{fullTitle}</title>
			<meta name="description" content={description} />
			{canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
			{noindex ? (
				<meta name="robots" content="noindex, nofollow" />
			) : (
				<meta name="robots" content="index, follow" />
			)}

			{/* Open Graph */}
			<meta property="og:title" content={fullTitle} />
			<meta property="og:description" content={description} />
			<meta property="og:image" content={ogImageUrl} />
			{canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
			<meta property="og:type" content={ogType} />
			<meta property="og:site_name" content="Rekrut AI" />

			{/* Twitter Card */}
			<meta name="twitter:card" content="summary_large_image" />
			<meta name="twitter:title" content={fullTitle} />
			<meta name="twitter:description" content={description} />
			<meta name="twitter:image" content={ogImageUrl} />

			{/* JSON-LD Structured Data */}
			{jsonLd && (
				<script type="application/ld+json">
					{JSON.stringify(jsonLd)}
				</script>
			)}
		</Helmet>
	)
}
