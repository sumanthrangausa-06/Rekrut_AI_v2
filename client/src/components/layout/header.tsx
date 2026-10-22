import {
	ArrowUpDown,
	Briefcase,
	Building2,
	ChevronDown,
	Crown,
	FileText,
	Filter,
	HelpCircle,
	LayoutDashboard,
	LogOut,
	Menu,
	MessageSquare,
	Search,
	Settings,
	Sparkles,
	User,
	Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NotificationCenter } from '@/components/domain/notification-center';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useAuth } from '@/contexts/auth-context';

interface HeaderProps {
	onMenuToggle: () => void;
	sidebarOpen: boolean;
}

type SortOption = {
	label: string;
	value: string;
};

const sortOptions: SortOption[] = [
	{ label: 'Relevance', value: 'relevance' },
	{ label: 'Newest', value: 'newest' },
	{ label: 'Salary: High to Low', value: 'salary-desc' },
	{ label: 'Salary: Low to High', value: 'salary-asc' },
];

interface NavLinkItem {
	label: string;
	href: string;
	icon: React.ElementType;
}

const candidateLinks: NavLinkItem[] = [
	{ label: 'All Matches', href: '/candidate/jobs', icon: Briefcase },
	{ label: 'Applications', href: '/candidate/applications', icon: FileText },
	{ label: 'Coaching', href: '/candidate/ai-coaching', icon: MessageSquare },
	{ label: 'Company Matches', href: '/candidate/company-matches', icon: Building2 },
];

const recruiterLinks: NavLinkItem[] = [
	{ label: 'Dashboard', href: '/recruiter', icon: LayoutDashboard },
	{ label: 'My Jobs', href: '/recruiter/jobs', icon: Briefcase },
	{ label: 'Candidates', href: '/recruiter/candidates', icon: Users },
	{ label: 'Company', href: '/recruiter/company', icon: Building2 },
];

function useDropdown() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') setOpen(false);
		}
		document.addEventListener('mousedown', handleClick);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('mousedown', handleClick);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, []);

	return { open, setOpen, ref };
}

// #1600: the header Filters sheet drives the Job Board's ONE filter model.
// It writes the board's own query-param names (search, location, type,
// remote_type, experience_level, salary_min, salary_max) to /candidate/jobs;
// jobs.tsx syncs its FilterState from those params, so the header door and
// the in-page JobFilterBar controls always set the same filters.
const FILTER_PARAM_KEYS = [
	'search',
	'location',
	'type',
	'remote_type',
	'experience_level',
	'salary_min',
	'salary_max',
] as const;

interface JobFilterDraft {
	search: string;
	location: string;
	type: string;
	remote_type: string;
	experience_level: string;
	salary_min: string;
	salary_max: string;
}

const EMPTY_FILTER_DRAFT: JobFilterDraft = {
	search: '',
	location: '',
	type: '',
	remote_type: '',
	experience_level: '',
	salary_min: '',
	salary_max: '',
};

function draftFromSearch(search: string): JobFilterDraft {
	const params = new URLSearchParams(search);
	// Only the header's own marked filter URLs prefill the draft — a bare
	// `type`/`location` param from any other link is not filter intent (#1600 B1).
	if (params.get('filters') !== '1') return EMPTY_FILTER_DRAFT;
	return {
		search: params.get('search') ?? '',
		location: params.get('location') ?? '',
		type: params.get('type') ?? '',
		remote_type: params.get('remote_type') ?? '',
		experience_level: params.get('experience_level') ?? '',
		salary_min: params.get('salary_min') ?? '',
		salary_max: params.get('salary_max') ?? '',
	};
}

export function Header({ onMenuToggle, sidebarOpen }: HeaderProps) {
	const { user, logout, isRecruiter } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();

	const userDropdown = useDropdown();
	const sortDropdown = useDropdown();
	const [sortValue, setSortValue] = useState('relevance');
	const [filterSheetOpen, setFilterSheetOpen] = useState(false);
	const [filterDraft, setFilterDraft] = useState<JobFilterDraft>(EMPTY_FILTER_DRAFT);

	const jobsPathForFilters = '/candidate/jobs';
	const onJobBoard = location.pathname === jobsPathForFilters;
	const urlParams = new URLSearchParams(location.search);
	const activeFilterCount =
		onJobBoard && urlParams.get('filters') === '1'
			? FILTER_PARAM_KEYS.filter((k) => urlParams.get(k)).length
			: 0;

	// Opening the sheet starts from the filters currently applied on the board.
	useEffect(() => {
		if (filterSheetOpen) setFilterDraft(draftFromSearch(location.search));
	}, [filterSheetOpen, location.search]);

	const applyFilters = () => {
		const params = new URLSearchParams();
		const hasAnyFilter = FILTER_PARAM_KEYS.some((k) => filterDraft[k]);
		// Marker: marks this URL as header-applied filter intent (#1600 B1).
		if (hasAnyFilter) params.set('filters', '1');
		if (filterDraft.search) params.set('search', filterDraft.search);
		if (filterDraft.location) params.set('location', filterDraft.location);
		if (filterDraft.type) params.set('type', filterDraft.type);
		if (filterDraft.remote_type) params.set('remote_type', filterDraft.remote_type);
		if (filterDraft.experience_level) params.set('experience_level', filterDraft.experience_level);
		if (filterDraft.salary_min) params.set('salary_min', filterDraft.salary_min);
		if (filterDraft.salary_max) params.set('salary_max', filterDraft.salary_max);
		// Preserve the board's non-filter params (e.g. an open job drawer).
		if (onJobBoard) {
			const current = new URLSearchParams(location.search);
			for (const key of ['job', 'skill']) {
				const v = current.get(key);
				if (v) params.set(key, v);
			}
		}
		const qs = params.toString();
		// Applying an empty draft is an explicit clear, not a bare navigation.
		navigate(qs ? `${jobsPathForFilters}?${qs}` : `${jobsPathForFilters}?filters=clear`);
		setFilterSheetOpen(false);
	};

	const clearFilters = () => {
		setFilterDraft(EMPTY_FILTER_DRAFT);
		// Explicit clear signal — the board resets its URL-driven fields for
		// `filters=clear` only; a bare navigation must never read as a clear.
		if (onJobBoard) navigate(`${jobsPathForFilters}?filters=clear`);
	};

	const isPremium = user?.subscriptionTier === 'pro';
	const navLinks = isRecruiter ? recruiterLinks : candidateLinks;
	const settingsPath = isRecruiter ? '/recruiter/settings' : '/candidate/settings';
	const profilePath = isRecruiter ? '/recruiter/company' : '/candidate/profile';
	const jobsPath = isRecruiter ? '/recruiter/jobs' : '/candidate/jobs';

	const handleSort = (value: string) => {
		setSortValue(value);
		sortDropdown.setOpen(false);
		// ponytail: UI-only for now; backend wiring in follow-up
		window.dispatchEvent(new CustomEvent('job-sort-change', { detail: { sort: value } }));
		// eslint-disable-next-line no-console
		console.log('Sort changed:', value);
	};

	const handleNav = (href: string) => {
		userDropdown.setOpen(false);
		navigate(href);
	};

	return (
		<header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/60 lg:px-6">
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={onMenuToggle}
					className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 hover:bg-muted lg:hidden"
					aria-label="Open navigation menu"
					aria-controls="primary-navigation"
					aria-expanded={sidebarOpen}
				>
					<Menu className="h-5 w-5" />
				</button>
				<Badge variant={isRecruiter ? 'default' : 'secondary'} className="hidden sm:inline-flex">
					{isRecruiter ? 'Recruiter' : 'Candidate'}
				</Badge>
			</div>

			<div className="flex items-center gap-2">
				{/* Try Premium CTA */}
				{!isPremium && (
					<button
						type="button"
						onClick={() => navigate('/pricing')}
						className="hidden rounded-md border border-indigo-500 px-3 py-1.5 text-sm font-medium text-indigo-500 transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/30 sm:inline-flex"
					>
						<Crown className="mr-1.5 h-4 w-4" />
						Try Premium
					</button>
				)}

				{/* Sort dropdown — hidden on mobile */}
				<div className="relative hidden md:block" ref={sortDropdown.ref}>
					<button
						type="button"
						onClick={() => sortDropdown.setOpen(!sortDropdown.open)}
						className="flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						aria-haspopup="menu"
						aria-expanded={sortDropdown.open}
					>
						<ArrowUpDown className="h-4 w-4 text-muted-foreground" />
						<span className="text-muted-foreground">
							{sortOptions.find((o) => o.value === sortValue)?.label}
						</span>
						<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
					</button>

					{sortDropdown.open && (
						<div
							role="menu"
							className="absolute right-0 mt-2 w-52 rounded-lg border bg-card shadow-lg"
						>
							<div className="p-1">
								{sortOptions.map((option) => (
									<button
										type="button"
										key={option.value}
										role="menuitem"
										onClick={() => handleSort(option.value)}
										className={`flex w-full items-center rounded-md px-3 py-2 text-sm transition-colors ${
											sortValue === option.value ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
										}`}
									>
										{option.label}
									</button>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Filters button — candidates only (the Job Board is a candidate
				    surface); visible at every width so the mobile journey works. */}
				{!isRecruiter && (
					<button
						type="button"
						onClick={() => setFilterSheetOpen(true)}
						className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
					>
						<Filter className="h-4 w-4 text-muted-foreground" />
						<span className="text-muted-foreground">Filters</span>
						{activeFilterCount > 0 && (
							<Badge className="bg-indigo-600 px-1.5 py-0 text-[10px] text-white">
								{activeFilterCount}
							</Badge>
						)}
					</button>
				)}

				<ThemeToggle />

				{/* Notification center (Issue #128) */}
				<NotificationCenter />

				{/* User dropdown */}
				<div className="relative" ref={userDropdown.ref}>
					<button
						type="button"
						onClick={() => userDropdown.setOpen(!userDropdown.open)}
						className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						aria-haspopup="menu"
						aria-expanded={userDropdown.open}
						aria-controls="user-menu"
					>
						<Avatar
							src={user?.avatar_url}
							fallback={user?.name || 'U'}
							seed={user?.email || user?.id || 'user'}
							size="sm"
						/>
						<span className="hidden text-sm font-medium md:block">{user?.name || 'User'}</span>
						<ChevronDown className="hidden h-4 w-4 text-muted-foreground md:block" />
					</button>

					{userDropdown.open && (
						<div
							id="user-menu"
							role="menu"
							aria-label="User menu"
							className="absolute right-0 mt-2 w-64 rounded-lg border bg-card shadow-lg"
						>
							{/* User info — click to open My Profile */}
							<button
								type="button"
								role="menuitem"
								onClick={() => handleNav(profilePath)}
								className="block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted"
								aria-label="Go to my profile"
							>
								<div className="flex items-center gap-3">
									<Avatar
										src={user?.avatar_url}
										fallback={user?.name || 'U'}
										seed={user?.email || user?.id || 'user'}
										size="sm"
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium">{user?.name}</p>
										<p className="truncate text-xs text-muted-foreground">{user?.email}</p>
									</div>
								</div>
								<div className="mt-2">
									<Badge variant={isRecruiter ? 'default' : 'secondary'} className="text-[10px]">
										{isRecruiter ? 'Recruiter' : 'Candidate'}
									</Badge>
								</div>
							</button>

							{/* Role-based navigation */}
							<div className="p-1">
								{navLinks.map((item) => (
									<button
										type="button"
										key={item.href}
										role="menuitem"
										onClick={() => handleNav(item.href)}
										className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
									>
										<item.icon className="h-4 w-4 text-muted-foreground" />
										{item.label}
									</button>
								))}
							</div>

							{/* Upgrade to Premium CTA */}
							{!isPremium && (
								<div className="px-2 pb-1">
									<button
										type="button"
										role="menuitem"
										onClick={() => handleNav('/pricing')}
										className="flex w-full items-center gap-2 rounded-md bg-indigo-50 px-3 py-2.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
									>
										<Sparkles className="h-4 w-4" />
										Upgrade to Premium
									</button>
								</div>
							)}

							<Separator />

							{/* General links */}
							<div className="p-1">
								<button
									type="button"
									role="menuitem"
									onClick={() => handleNav(profilePath)}
									className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
								>
									<User className="h-4 w-4 text-muted-foreground" />
									My Profile
								</button>
								<button
									type="button"
									role="menuitem"
									onClick={() => handleNav(jobsPath)}
									className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
								>
									<Search className="h-4 w-4 text-muted-foreground" />
									Manual Job Search
								</button>
								<button
									type="button"
									role="menuitem"
									onClick={() => handleNav('/faq')}
									className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
								>
									<HelpCircle className="h-4 w-4 text-muted-foreground" />
									FAQ
								</button>
								<button
									type="button"
									role="menuitem"
									onClick={() => handleNav(settingsPath)}
									className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
								>
									<Settings className="h-4 w-4 text-muted-foreground" />
									Settings
								</button>
							</div>

							<Separator />

							{/* Sign out */}
							<div className="p-1">
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										userDropdown.setOpen(false);
										logout();
									}}
									className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
								>
									<LogOut className="h-4 w-4" />
									Sign out
								</button>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Filter sheet — the Job Board's real filters (#1600). Apply writes
			    the board's query params; the board syncs its state from them. */}
			<Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
				<SheetHeader>
					<SheetTitle>Filters</SheetTitle>
					<SheetClose />
				</SheetHeader>
				<SheetContent>
					<div className="space-y-5 px-1 pb-4">
						<div>
							<label htmlFor="header-filter-search" className="mb-2 block text-sm font-semibold">
								Keyword
							</label>
							<Input
								id="header-filter-search"
								placeholder="Job title or keyword..."
								value={filterDraft.search}
								onChange={(e) => setFilterDraft((d) => ({ ...d, search: e.target.value }))}
								className="h-11 text-base sm:text-sm"
							/>
						</div>
						<div>
							<label htmlFor="header-filter-location" className="mb-2 block text-sm font-semibold">
								Location
							</label>
							<Input
								id="header-filter-location"
								placeholder="City, state, or country..."
								value={filterDraft.location}
								onChange={(e) => setFilterDraft((d) => ({ ...d, location: e.target.value }))}
								className="h-11 text-base sm:text-sm"
							/>
						</div>
						<div>
							<label htmlFor="header-filter-type" className="mb-2 block text-sm font-semibold">
								Job Type
							</label>
							<select
								id="header-filter-type"
								value={filterDraft.type}
								onChange={(e) => setFilterDraft((d) => ({ ...d, type: e.target.value }))}
								className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base sm:text-sm"
							>
								<option value="">All Types</option>
								<option value="full-time">Full-time</option>
								<option value="part-time">Part-time</option>
								<option value="internship">Internship</option>
								<option value="contract">Contract</option>
							</select>
						</div>
						<div>
							<label htmlFor="header-filter-remote" className="mb-2 block text-sm font-semibold">
								Work Mode
							</label>
							<select
								id="header-filter-remote"
								value={filterDraft.remote_type}
								onChange={(e) => setFilterDraft((d) => ({ ...d, remote_type: e.target.value }))}
								className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base sm:text-sm"
							>
								<option value="">Any</option>
								<option value="remote">Remote</option>
								<option value="hybrid">Hybrid</option>
								<option value="onsite">On-site</option>
							</select>
						</div>
						<div>
							<label
								htmlFor="header-filter-experience"
								className="mb-2 block text-sm font-semibold"
							>
								Experience Level
							</label>
							<select
								id="header-filter-experience"
								value={filterDraft.experience_level}
								onChange={(e) =>
									setFilterDraft((d) => ({ ...d, experience_level: e.target.value }))
								}
								className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base sm:text-sm"
							>
								<option value="">All Levels</option>
								<option value="entry">Entry Level</option>
								<option value="mid">Mid Level</option>
								<option value="senior">Senior</option>
								<option value="lead">Lead / Staff</option>
								<option value="executive">Executive</option>
							</select>
						</div>
						<div>
							<span className="mb-2 block text-sm font-semibold">Salary Range</span>
							<div className="flex items-center gap-2">
								<label htmlFor="header-filter-salary-min" className="sr-only">
									Minimum salary
								</label>
								<Input
									id="header-filter-salary-min"
									placeholder="Min"
									type="number"
									min={0}
									value={filterDraft.salary_min}
									onChange={(e) => setFilterDraft((d) => ({ ...d, salary_min: e.target.value }))}
									className="h-11 text-base sm:text-sm"
								/>
								<span className="text-sm text-muted-foreground">to</span>
								<label htmlFor="header-filter-salary-max" className="sr-only">
									Maximum salary
								</label>
								<Input
									id="header-filter-salary-max"
									placeholder="Max"
									type="number"
									min={0}
									value={filterDraft.salary_max}
									onChange={(e) => setFilterDraft((d) => ({ ...d, salary_max: e.target.value }))}
									className="h-11 text-base sm:text-sm"
								/>
							</div>
						</div>
						<div className="flex gap-2 pt-2">
							<button
								type="button"
								onClick={applyFilters}
								className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							>
								Apply Filters
							</button>
							<button
								type="button"
								onClick={clearFilters}
								className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-transparent px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							>
								Clear Filters
							</button>
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</header>
	);
}
