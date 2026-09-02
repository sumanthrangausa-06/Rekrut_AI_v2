import {
	ChevronDown,
	ChevronUp,
	DollarSign,
	Globe,
	MapPin,
	RotateCcw,
	SlidersHorizontal,
	Tag,
	X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export interface JobFilterValues {
	search: string;
	type: string;
	location: string;
	remoteType: string;
	experienceLevel: string;
	salaryMin: number;
	salaryMax: number;
	skills: string[];
	companySize: string;
	sortBy: 'match' | 'newest' | 'salary_high' | 'salary_low';
	remoteOnly: boolean;
}

interface JobFilterBarProps {
	filters: JobFilterValues;
	jobTypes: string[];
	allSkills: string[];
	activeFilterCount: number;
	onFilterChange: (key: keyof JobFilterValues, value: any) => void;
	onToggleSkill: (skill: string) => void;
	onClearAll: () => void;
}

function SalaryLabel({ value }: { value: number }) {
	return (
		<span className="text-xs font-medium text-muted-foreground">${(value / 1000).toFixed(0)}k</span>
	);
}

export function JobFilterBar({
	filters,
	jobTypes,
	allSkills,
	activeFilterCount,
	onFilterChange,
	onToggleSkill,
	onClearAll,
}: JobFilterBarProps) {
	const [mobileOpen, setMobileOpen] = useState(false);

	// For mobile 16px inputs to prevent iOS zoom
	const inputBaseClass = 'text-base sm:text-sm';

	return (
		<>
			{/* Desktop: horizontal filter bar */}
			<div className="hidden sm:flex items-center gap-2 px-4 py-2.5 border-b bg-background/50 overflow-x-auto scrollbar-hide">
				{/* Location */}
				<div className="relative min-w-[160px]">
					<MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input
						placeholder="Location..."
						value={filters.location}
						onChange={(e) => onFilterChange('location', e.target.value)}
						className={cn('pl-8 h-9 text-xs', inputBaseClass)}
					/>
				</div>

				{/* Salary min */}
				<div className="relative min-w-[120px]">
					<DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input
						placeholder="Min salary"
						type="number"
						value={filters.salaryMin > 0 ? filters.salaryMin : ''}
						onChange={(e) => onFilterChange('salaryMin', Number(e.target.value) || 0)}
						className={cn('pl-8 h-9 text-xs', inputBaseClass)}
					/>
				</div>

				{/* Salary max */}
				<div className="relative min-w-[120px]">
					<DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input
						placeholder="Max salary"
						type="number"
						value={filters.salaryMax < 300000 ? filters.salaryMax : ''}
						onChange={(e) => onFilterChange('salaryMax', Number(e.target.value) || 300000)}
						className={cn('pl-8 h-9 text-xs', inputBaseClass)}
					/>
				</div>

				{/* Remote toggle */}
				<button
					onClick={() => onFilterChange('remoteOnly', !filters.remoteOnly)}
					className={cn(
						'flex items-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium transition-colors whitespace-nowrap',
						filters.remoteOnly
							? 'bg-indigo-50 border-indigo-200 text-indigo-700'
							: 'bg-transparent border-input text-muted-foreground hover:bg-muted',
					)}
				>
					<Globe className="h-3.5 w-3.5" />
					Remote Only
				</button>

				{/* Job type */}
				{jobTypes.length > 0 && (
					<select
						value={filters.type}
						onChange={(e) => onFilterChange('type', e.target.value)}
						className="h-9 text-xs bg-transparent border rounded-md px-2 min-w-[100px]"
					>
						<option value="">All Types</option>
						{jobTypes.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
				)}

				{/* Experience level */}
				<select
					value={filters.experienceLevel}
					onChange={(e) => onFilterChange('experienceLevel', e.target.value)}
					className="h-9 text-xs bg-transparent border rounded-md px-2 min-w-[100px]"
				>
					<option value="">All Levels</option>
					<option value="entry">Entry Level</option>
					<option value="mid">Mid Level</option>
					<option value="senior">Senior</option>
					<option value="lead">Lead / Staff</option>
					<option value="executive">Executive</option>
				</select>

				{/* Company size */}
				<select
					value={filters.companySize}
					onChange={(e) => onFilterChange('companySize', e.target.value)}
					className="h-9 text-xs bg-transparent border rounded-md px-2 min-w-[100px]"
				>
					<option value="">All Sizes</option>
					<option value="startup">Startup (1-50)</option>
					<option value="small">Small (51-200)</option>
					<option value="medium">Medium (201-1000)</option>
					<option value="large">Large (1000+)</option>
				</select>

				{/* Active filter badge + clear */}
				{activeFilterCount > 0 && (
					<button
						onClick={onClearAll}
						className="text-xs text-indigo-600 hover:underline flex items-center gap-1 ml-1 shrink-0"
					>
						<RotateCcw className="h-3 w-3" /> Clear
					</button>
				)}
			</div>

			{/* Mobile: filter button */}
			<div className="sm:hidden px-4 py-2 border-b bg-background/50 flex items-center gap-2 overflow-x-auto scrollbar-hide">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setMobileOpen(true)}
					className="gap-2 h-10 text-base"
				>
					<SlidersHorizontal className="h-4 w-4" />
					Filters
					{activeFilterCount > 0 && (
						<Badge className="bg-indigo-600 text-white text-[10px] px-1.5 py-0">
							{activeFilterCount}
						</Badge>
					)}
				</Button>

				{/* Quick location on mobile */}
				<div className="relative flex-1 min-w-0">
					<MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input
						placeholder="Location..."
						value={filters.location}
						onChange={(e) => onFilterChange('location', e.target.value)}
						className={cn('pl-8 h-10 text-base', inputBaseClass)}
					/>
				</div>
			</div>

			{/* Mobile filter sheet */}
			<Sheet
				open={mobileOpen}
				onOpenChange={setMobileOpen}
				side="bottom"
				className="h-[85dvh] rounded-t-xl"
			>
				<SheetContent>
					<SheetHeader className="pb-2">
						<SheetTitle className="flex items-center gap-2 text-base">
							<SlidersHorizontal className="h-5 w-5" />
							Filters
							{activeFilterCount > 0 && (
								<Badge className="bg-indigo-600 text-white text-[10px] px-1.5 py-0">
									{activeFilterCount}
								</Badge>
							)}
						</SheetTitle>
						<SheetClose />
					</SheetHeader>
					<div className="overflow-y-auto h-full pb-20 space-y-5 px-1">
						{/* Location */}
						<div>
							<label className="text-sm font-semibold mb-2 block">Location</label>
							<div className="relative">
								<MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
								<Input
									placeholder="City, state, or country..."
									value={filters.location}
									onChange={(e) => onFilterChange('location', e.target.value)}
									className={cn('pl-10 h-12 text-base', inputBaseClass)}
								/>
							</div>
						</div>

						<Separator />

						{/* Salary range */}
						<div>
							<label className="text-sm font-semibold mb-2 block">Salary Range</label>
							<div className="flex items-center gap-2">
								<div className="relative flex-1">
									<DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
									<Input
										placeholder="Min"
										type="number"
										value={filters.salaryMin > 0 ? filters.salaryMin : ''}
										onChange={(e) => onFilterChange('salaryMin', Number(e.target.value) || 0)}
										className={cn('pl-10 h-12 text-base', inputBaseClass)}
									/>
								</div>
								<span className="text-muted-foreground text-sm">to</span>
								<div className="relative flex-1">
									<DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
									<Input
										placeholder="Max"
										type="number"
										value={filters.salaryMax < 300000 ? filters.salaryMax : ''}
										onChange={(e) => onFilterChange('salaryMax', Number(e.target.value) || 300000)}
										className={cn('pl-10 h-12 text-base', inputBaseClass)}
									/>
								</div>
							</div>
						</div>

						<Separator />

						{/* Remote toggle */}
						<div>
							<button
								onClick={() => onFilterChange('remoteOnly', !filters.remoteOnly)}
								className={cn(
									'w-full flex items-center justify-between h-14 px-4 rounded-xl border transition-colors',
									filters.remoteOnly
										? 'bg-indigo-50 border-indigo-200 text-indigo-700'
										: 'bg-transparent border-input text-foreground hover:bg-muted/50',
								)}
							>
								<div className="flex items-center gap-2">
									<Globe className="h-5 w-5" />
									<span className="text-base font-medium">Remote Only</span>
								</div>
								<div
									className={cn(
										'w-11 h-6 rounded-full transition-colors relative',
										filters.remoteOnly ? 'bg-indigo-500' : 'bg-muted-foreground/30',
									)}
								>
									<div
										className={cn(
											'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
											filters.remoteOnly ? 'left-[22px]' : 'left-0.5',
										)}
									/>
								</div>
							</button>
						</div>

						<Separator />

						{/* Job type */}
						<div>
							<label className="text-sm font-semibold mb-2 block">Job Type</label>
							<div className="space-y-1">
								<MobileRadioOption
									label="All Types"
									checked={filters.type === ''}
									onClick={() => onFilterChange('type', '')}
								/>
								{jobTypes.map((t) => (
									<MobileRadioOption
										key={t}
										label={t}
										checked={filters.type === t}
										onClick={() => onFilterChange('type', t)}
									/>
								))}
							</div>
						</div>

						<Separator />

						{/* Experience level */}
						<div>
							<label className="text-sm font-semibold mb-2 block">Experience Level</label>
							<div className="space-y-1">
								<MobileRadioOption
									label="All Levels"
									checked={filters.experienceLevel === ''}
									onClick={() => onFilterChange('experienceLevel', '')}
								/>
								{[
									{ value: 'entry', label: 'Entry Level' },
									{ value: 'mid', label: 'Mid Level' },
									{ value: 'senior', label: 'Senior' },
									{ value: 'lead', label: 'Lead / Staff' },
									{ value: 'executive', label: 'Executive' },
								].map((opt) => (
									<MobileRadioOption
										key={opt.value}
										label={opt.label}
										checked={filters.experienceLevel === opt.value}
										onClick={() => onFilterChange('experienceLevel', opt.value)}
									/>
								))}
							</div>
						</div>

						<Separator />

						{/* Skills multi-select */}
						{allSkills.length > 0 && (
							<div>
								<label className="text-sm font-semibold mb-2 flex items-center gap-1.5">
									<Tag className="h-3.5 w-3.5" />
									Skills ({allSkills.length})
								</label>
								<div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
									{allSkills.map((skill) => (
										<button
											key={skill}
											onClick={() => onToggleSkill(skill)}
											className={cn(
												'px-3 py-2 rounded-lg text-sm border transition-colors',
												filters.skills.includes(skill)
													? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium'
													: 'bg-transparent border-input text-foreground hover:bg-muted/50',
											)}
										>
											{skill}
										</button>
									))}
								</div>
							</div>
						)}

						{/* Clear filters */}
						{activeFilterCount > 0 && (
							<Button
								variant="outline"
								className="w-full gap-2 h-12 text-base"
								onClick={() => {
									onClearAll();
									setMobileOpen(false);
								}}
							>
								<RotateCcw className="h-4 w-4" />
								Clear All Filters
							</Button>
						)}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}

function MobileRadioOption({
	label,
	checked,
	onClick,
}: {
	label: string;
	checked: boolean;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className={cn(
				'w-full flex items-center gap-3 h-12 px-3 rounded-lg border transition-colors text-left',
				checked
					? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium'
					: 'bg-transparent border-input text-foreground hover:bg-muted/50',
			)}
		>
			<div
				className={cn(
					'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
					checked ? 'border-indigo-500' : 'border-muted-foreground/40',
				)}
			>
				{checked && <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />}
			</div>
			<span className="text-sm">{label}</span>
		</button>
	);
}
