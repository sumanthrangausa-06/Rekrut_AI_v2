import { ArrowLeft, Calendar, Clock, Tag, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { trackEvent } from '@/lib/analytics'

interface BlogPost {
	id: string
	slug: string
	title: string
	excerpt: string
	content: string
	author: string
	authorRole: string
	publishedAt: string
	readTime: number
	tags: string[]
	category: string
	featured: boolean
	image?: string
}

interface BlogData {
	posts: BlogPost[]
	categories: string[]
	stats: {
		total: number
		byCategory: Record<string, number>
	}
}

export function BlogPage() {
	const [data, setData] = useState<BlogData | null>(null)
	const [loading, setLoading] = useState(true)
	const [selectedCategory, setSelectedCategory] = useState<string>('all')
	const [searchQuery, setSearchQuery] = useState('')

	useEffect(() => {
		async function loadBlog() {
			try {
				const res = await fetch('/blog-posts.json')
				if (!res.ok) throw new Error('Failed to load blog posts')
				const json = await res.json()
				setData(json)
				trackEvent('blog_page_view')
			} catch (err) {
				console.error('Blog load error:', err)
				// Fallback: empty state
			} finally {
				setLoading(false)
			}
		}
		loadBlog()
	}, [])

	const filteredPosts =
		data?.posts.filter((post) => {
			if (selectedCategory !== 'all' && post.category !== selectedCategory) return false
			if (searchQuery) {
				const q = searchQuery.toLowerCase()
				return (
					post.title.toLowerCase().includes(q) ||
					post.excerpt.toLowerCase().includes(q) ||
					post.tags.some((t) => t.toLowerCase().includes(q))
				)
			}
			return true
		}) || []

	const featuredPost = data?.posts.find((p) => p.featured)
	const regularPosts = filteredPosts.filter((p) => p.id !== featuredPost?.id)

	return (
		<div className='min-h-screen bg-background'>
			{/* Header */}
			<div className='border-b bg-muted/50'>
				<div className='max-w-5xl mx-auto px-6 py-8'>
					<div className='flex items-center gap-2 mb-4'>
						<Link
							to='/'
							className='text-sm text-muted-foreground hover:text-primary transition-colors'
						>
							Home
						</Link>
						<span className='text-muted-foreground'>/</span>
						<span className='text-sm font-medium'>Blog</span>
					</div>
					<h1 className='font-heading text-2xl sm:text-3xl font-bold mb-2'>HireLoop Blog</h1>
					<p className='text-muted-foreground max-w-2xl'>
						Insights, tips, and strategies for modern recruitment and career growth.
					</p>
				</div>
			</div>

			<div className='max-w-5xl mx-auto px-6 py-8 space-y-8'>
				{/* Search & Filters */}
				<div className='flex flex-col sm:flex-row gap-4'>
					<div className='flex-1'>
						<input
							type='text'
							placeholder='Search articles...'
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className='w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
						/>
					</div>
					<div className='flex gap-2 flex-wrap'>
						<Button
							variant={selectedCategory === 'all' ? 'default' : 'outline'}
							size='sm'
							onClick={() => setSelectedCategory('all')}
						>
							All
						</Button>
						{data?.categories.map((cat) => (
							<Button
								key={cat}
								variant={selectedCategory === cat ? 'default' : 'outline'}
								size='sm'
								onClick={() => setSelectedCategory(cat)}
							>
								{cat}
							</Button>
						))}
					</div>
				</div>

				{loading ? (
					<div className='space-y-4'>
						<Skeleton className='h-64 w-full' />
						<div className='grid gap-4 md:grid-cols-2'>
							<Skeleton className='h-48' />
							<Skeleton className='h-48' />
						</div>
					</div>
				) : (
					<>
						{/* Featured Post */}
						{featuredPost && selectedCategory === 'all' && !searchQuery && (
							<Card className='overflow-hidden border-2 border-primary/20'>
								<div className='grid md:grid-cols-2'>
									<div className='bg-gradient-to-br from-primary/10 to-primary/5 p-6 flex flex-col justify-center'>
										<Badge className='w-fit mb-3'>Featured</Badge>
										<h2 className='text-2xl font-bold mb-2'>{featuredPost.title}</h2>
										<p className='text-muted-foreground mb-4'>{featuredPost.excerpt}</p>
										<div className='flex items-center gap-4 text-sm text-muted-foreground mb-4'>
											<span className='flex items-center gap-1'>
												<User className='h-3.5 w-3.5' />
												{featuredPost.author}
											</span>
											<span className='flex items-center gap-1'>
												<Calendar className='h-3.5 w-3.5' />
												{new Date(featuredPost.publishedAt).toLocaleDateString()}
											</span>
											<span className='flex items-center gap-1'>
												<Clock className='h-3.5 w-3.5' />
												{featuredPost.readTime} min read
											</span>
										</div>
										<Link to={`/blog/${featuredPost.slug}`}>
											<Button>Read Article</Button>
										</Link>
									</div>
									<div className='bg-muted flex items-center justify-center p-8'>
										<div className='text-center text-muted-foreground'>
											<div className='w-32 h-32 mx-auto mb-4 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center'>
												<span className='text-4xl'>📰</span>
											</div>
											<p className='text-sm'>HireLoop Insights</p>
										</div>
									</div>
								</div>
							</Card>
						)}

						{/* Posts Grid */}
						{regularPosts.length === 0 ? (
							<div className='text-center py-16'>
								<p className='text-muted-foreground'>No articles found.</p>
							</div>
						) : (
							<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
								{regularPosts.map((post) => (
									<Card
										key={post.id}
										className='group overflow-hidden hover:shadow-md transition-all'
									>
										<CardHeader className='pb-3'>
											<div className='flex items-center gap-2 mb-2'>
												<Badge variant='secondary' className='text-xs'>
													{post.category}
												</Badge>
											</div>
											<Link
												to={`/blog/${post.slug}`}
												className='group-hover:text-primary transition-colors'
											>
												<CardTitle className='text-lg leading-tight'>{post.title}</CardTitle>
											</Link>
										</CardHeader>
										<CardContent className='pt-0'>
											<p className='text-sm text-muted-foreground line-clamp-2 mb-4'>
												{post.excerpt}
											</p>
											<div className='flex items-center justify-between text-xs text-muted-foreground'>
												<div className='flex items-center gap-2'>
													<span>{post.author}</span>
													<span>•</span>
													<span className='flex items-center gap-1'>
														<Clock className='h-3 w-3' />
														{post.readTime} min
													</span>
												</div>
												<span>{new Date(post.publishedAt).toLocaleDateString()}</span>
											</div>
											<div className='flex flex-wrap gap-1 mt-3'>
												{post.tags.slice(0, 3).map((tag) => (
													<Badge key={tag} variant='outline' className='text-[10px]'>
														<Tag className='h-2.5 w-2.5 mr-1' />
														{tag}
													</Badge>
												))}
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}

export function BlogPostPage() {
	const { slug } = useParams<{ slug: string }>()
	const [post, setPost] = useState<BlogPost | null>(null)
	const [loading, setLoading] = useState(true)
	const [related, setRelated] = useState<BlogPost[]>([])

	useEffect(() => {
		async function loadPost() {
			try {
				const res = await fetch('/blog-posts.json')
				if (!res.ok) throw new Error('Failed to load blog posts')
				const data: BlogData = await res.json()
				const found = data.posts.find((p) => p.slug === slug)
				if (found) {
					setPost(found)
					setRelated(
						data.posts
							.filter((p) => p.id !== found.id && p.category === found.category)
							.slice(0, 3),
					)
					trackEvent('blog_post_view', { post_slug: slug, post_title: found.title })
				}
			} catch (err) {
				console.error('Blog post load error:', err)
			} finally {
				setLoading(false)
			}
		}
		loadPost()
	}, [slug])

	if (loading) {
		return (
			<div className='max-w-3xl mx-auto px-6 py-8 space-y-4'>
				<Skeleton className='h-8 w-3/4' />
				<Skeleton className='h-4 w-1/2' />
				<Skeleton className='h-64 w-full' />
			</div>
		)
	}

	if (!post) {
		return (
			<div className='max-w-3xl mx-auto px-6 py-16 text-center'>
				<h1 className='text-2xl font-bold mb-4'>Article Not Found</h1>
				<p className='text-muted-foreground mb-6'>
					The article you're looking for doesn't exist or has been removed.
				</p>
				<Link to='/blog'>
					<Button>
						<ArrowLeft className='h-4 w-4 mr-2' />
						Back to Blog
					</Button>
				</Link>
			</div>
		)
	}

	return (
		<div className='min-h-screen bg-background'>
			{/* Header */}
			<div className='border-b bg-muted/50'>
				<div className='max-w-3xl mx-auto px-6 py-8'>
					<div className='flex items-center gap-2 mb-4'>
						<Link
							to='/'
							className='text-sm text-muted-foreground hover:text-primary transition-colors'
						>
							Home
						</Link>
						<span className='text-muted-foreground'>/</span>
						<Link
							to='/blog'
							className='text-sm text-muted-foreground hover:text-primary transition-colors'
						>
							Blog
						</Link>
						<span className='text-muted-foreground'>/</span>
						<span className='text-sm font-medium'>{post.category}</span>
					</div>
					<Badge className='mb-3'>{post.category}</Badge>
					<h1 className='font-heading text-2xl sm:text-3xl font-bold mb-4'>{post.title}</h1>
					<div className='flex items-center gap-4 text-sm text-muted-foreground'>
						<span className='flex items-center gap-1'>
							<User className='h-4 w-4' />
							{post.author}, {post.authorRole}
						</span>
						<span className='flex items-center gap-1'>
							<Calendar className='h-4 w-4' />
							{new Date(post.publishedAt).toLocaleDateString(undefined, {
								year: 'numeric',
								month: 'long',
								day: 'numeric',
							})}
						</span>
						<span className='flex items-center gap-1'>
							<Clock className='h-4 w-4' />
							{post.readTime} min read
						</span>
					</div>
					<div className='flex flex-wrap gap-1 mt-4'>
						{post.tags.map((tag) => (
							<Badge key={tag} variant='outline'>
								<Tag className='h-3 w-3 mr-1' />
								{tag}
							</Badge>
						))}
					</div>
				</div>
			</div>

			{/* Content */}
			<div className='max-w-3xl mx-auto px-6 py-8'>
				<div className='prose prose-slate dark:prose-invert max-w-none'>
					<div dangerouslySetInnerHTML={{ __html: post.content }} />
				</div>
			</div>

			{/* Related Posts */}
			{related.length > 0 && (
				<div className='border-t bg-muted/30'>
					<div className='max-w-3xl mx-auto px-6 py-8'>
						<h2 className='font-heading text-xl font-bold mb-4'>Related Articles</h2>
						<div className='grid gap-4 md:grid-cols-3'>
							{related.map((r) => (
								<Link key={r.id} to={`/blog/${r.slug}`}>
									<Card className='hover:shadow-md transition-all'>
										<CardContent className='p-4'>
											<Badge variant='secondary' className='text-xs mb-2'>
												{r.category}
											</Badge>
											<h3 className='font-semibold text-sm leading-tight mb-2'>{r.title}</h3>
											<p className='text-xs text-muted-foreground line-clamp-2'>{r.excerpt}</p>
										</CardContent>
									</Card>
								</Link>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Footer CTA */}
			<div className='border-t'>
				<div className='max-w-3xl mx-auto px-6 py-8 text-center'>
					<p className='text-muted-foreground mb-4'>Ready to transform your hiring process?</p>
					<div className='flex gap-2 justify-center'>
						<Link to='/register'>
							<Button>Get Started Free</Button>
						</Link>
						<Link to='/blog'>
							<Button variant='outline'>
								<ArrowLeft className='h-4 w-4 mr-2' />
								More Articles
							</Button>
						</Link>
					</div>
				</div>
			</div>
		</div>
	)
}
