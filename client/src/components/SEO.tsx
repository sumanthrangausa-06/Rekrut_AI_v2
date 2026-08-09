import { useEffect } from 'react'

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

	useEffect(() => {
		document.title = fullTitle

		const metaTags: Record<string, string> = {
			'description': description,
			'robots': noindex ? 'noindex, nofollow' : 'index, follow',
			'og:title': fullTitle,
			'og:description': description,
			'og:image': ogImageUrl,
			'og:type': ogType,
			'og:site_name': 'Rekrut AI',
			'twitter:card': 'summary_large_image',
			'twitter:title': fullTitle,
			'twitter:description': description,
			'twitter:image': ogImageUrl,
		}

		if (canonicalUrl) {
			metaTags['og:url'] = canonicalUrl
		}

		// Update or create meta tags
		Object.entries(metaTags).forEach(([name, content]) => {
			const isOg = name.startsWith('og:')
			const isTwitter = name.startsWith('twitter:')
			let selector: string
			if (isOg) {
				selector = `meta[property="${name}"]`
			} else if (isTwitter) {
				selector = `meta[name="${name}"]`
			} else {
				selector = `meta[name="${name}"]`
			}

			let el = document.querySelector(selector) as HTMLMetaElement | null
			if (!el) {
				el = document.createElement('meta')
				if (isOg) {
					el.setAttribute('property', name)
				} else {
					el.setAttribute('name', name)
				}
				document.head.appendChild(el)
			}
			el.content = content
		})

		// Canonical link
		if (canonicalUrl) {
			let linkEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
			if (!linkEl) {
				linkEl = document.createElement('link')
				linkEl.rel = 'canonical'
				document.head.appendChild(linkEl)
			}
			linkEl.href = canonicalUrl
		}

		// JSON-LD
		if (jsonLd) {
			let scriptEl = document.querySelector('script[type="application/ld+json"]') as HTMLScriptElement | null
			if (!scriptEl) {
				scriptEl = document.createElement('script')
				scriptEl.type = 'application/ld+json'
				document.head.appendChild(scriptEl)
			}
			scriptEl.textContent = JSON.stringify(jsonLd)
		}

		return () => {
			// Note: we intentionally don't clean up on unmount to avoid flickering
			// between page transitions. The next page's SEO effect will overwrite.
		}
	}, [fullTitle, description, canonicalUrl, ogImageUrl, ogType, noindex, jsonLd])

	// React 19 native metadata support — these get hoisted to <head> automatically
	return (
		<>
			<title>{fullTitle}</title>
			<meta name="description" content={description} />
			{noindex ? (
				<meta name="robots" content="noindex, nofollow" />
			) : (
				<meta name="robots" content="index, follow" />
			)}
			{canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
			<meta property="og:title" content={fullTitle} />
			<meta property="og:description" content={description} />
			<meta property="og:image" content={ogImageUrl} />
			{canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
			<meta property="og:type" content={ogType} />
			<meta property="og:site_name" content="Rekrut AI" />
			<meta name="twitter:card" content="summary_large_image" />
			<meta name="twitter:title" content={fullTitle} />
			<meta name="twitter:description" content={description} />
			<meta name="twitter:image" content={ogImageUrl} />
			{jsonLd && (
				<script type="application/ld+json">
					{JSON.stringify(jsonLd)}
				</script>
			)}
		</>
	)
}
