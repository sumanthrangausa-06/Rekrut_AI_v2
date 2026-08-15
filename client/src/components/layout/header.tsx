import {
	ArrowUpDown,
	Bell,
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
	Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
	{ label: 'Coaching', href: '/candidate/coaching', icon: MessageSquare },
	{ label: 'Company Matches', href: '/candidate/company-matches', icon: Building2 },
];

const recruiterLinks: NavLinkItem[] = [
	{ label: 'Dashboard', href: '/recruiter/dashboard', icon: LayoutDashboard },
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

export function Header({ onMenuToggle, sidebarOpen }: HeaderProps) {
	const { user, logout, isRecruiter } = useAuth();
	const navigate = useNavigate();

	const userDropdown = useDropdown();
	const sortDropdown = useDropdown();
	const [sortValue, setSortValue] = useState('relevance');
	const [filterSheetOpen, setFilterSheetOpen] = useState(false);

	const isPremium = user?.subscriptionTier === 'pro';
	const navLinks = isRecruiter ? recruiterLinks : candidateLinks;
	const settingsPath = isRecruiter ? '/recruiter/settings' : '/candidate/settings';
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

				{/* Filters button — hidden on mobile */}
				<button
					type="button"
					onClick={() => setFilterSheetOpen(true)}
					className="hidden h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:inline-flex"
				>
					<Filter className="h-4 w-4 text-muted-foreground" />
					<span className="text-muted-foreground">Filters</span>
				</button>

				<ThemeToggle />

				<button
					type="button"
					className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					aria-label="Notifications"
					title="Notifications"
				>
					<Bell className="h-5 w-5 text-muted-foreground" />
				</button>

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
							{/* User info */}
							<div className="border-b px-4 py-3">
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
							</div>

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

			{/* Filter sheet */}
			<Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
				<SheetHeader>
					<SheetTitle>Filters</SheetTitle>
					<SheetClose />
				</SheetHeader>
				<SheetContent>
					<p className="text-sm text-muted-foreground">Filter options will be wired here.</p>
				</SheetContent>
			</Sheet>
		</header>
	);
}
