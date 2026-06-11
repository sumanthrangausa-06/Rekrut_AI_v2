import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	Search,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type SortConfig = {
	key: string
	direction: 'asc' | 'desc'
}

export type DataTableProps<T> = {
	data: T[]
	columns: Array<{
		key: string
		header: string
		sortable?: boolean
		render?: (row: T) => React.ReactNode
		width?: string
	}>
	sortable?: boolean
	searchable?: boolean
	searchKeys?: string[]
	pagination?: boolean
	pageSize?: number
	className?: string
	emptyState?: React.ReactNode
	onRowClick?: (row: T) => void
	rowClassName?: (row: T) => string
	keyExtractor: (row: T) => string
}

export function DataTable<T>({
	data,
	columns,
	sortable = true,
	searchable = true,
	searchKeys,
	pagination = true,
	pageSize = 10,
	className,
	emptyState,
	onRowClick,
	rowClassName,
	keyExtractor,
}: DataTableProps<T>) {
	const [sort, setSort] = useState<SortConfig | null>(null)
	const [search, setSearch] = useState('')
	const [currentPage, setCurrentPage] = useState(1)

	// Filter
	let filtered = data
	if (searchable && search) {
		const keys = searchKeys || columns.map((c) => c.key)
		const q = search.toLowerCase()
		filtered = data.filter((row) =>
			keys.some((key) => {
				const val = (row as any)[key]
				return val != null && String(val).toLowerCase().includes(q)
			}),
		)
	}

	// Sort
	if (sortable && sort) {
		filtered = [...filtered].sort((a, b) => {
			const aVal = (a as any)[sort.key]
			const bVal = (b as any)[sort.key]
			if (aVal == null && bVal == null) return 0
			if (aVal == null) return 1
			if (bVal == null) return -1
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				return sort.direction === 'asc' ? aVal - bVal : bVal - aVal
			}
			const aStr = String(aVal).toLowerCase()
			const bStr = String(bVal).toLowerCase()
			return sort.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
		})
	}

	// Paginate
	const totalPages = pagination ? Math.ceil(filtered.length / pageSize) : 1
	const paginated = pagination
		? filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
		: filtered

	const handleSort = (key: string) => {
		if (!sortable) return
		setSort((prev) => {
			if (prev?.key === key) {
				return prev.direction === 'asc' ? { key, direction: 'desc' } : null
			}
			return { key, direction: 'asc' }
		})
	}

	const SortIcon = ({ columnKey }: { columnKey: string }) => {
		if (!sortable) return null
		if (sort?.key !== columnKey)
			return <ArrowUpDown className='h-3.5 w-3.5 text-muted-foreground/50' />
		return sort.direction === 'asc' ? (
			<ArrowUp className='h-3.5 w-3.5 text-primary' />
		) : (
			<ArrowDown className='h-3.5 w-3.5 text-primary' />
		)
	}

	return (
		<div className={cn('space-y-4', className)}>
			{/* Search */}
			{searchable && (
				<div className='relative max-w-sm'>
					<Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
					<Input
						placeholder='Search...'
						value={search}
						onChange={(e) => {
							setSearch(e.target.value)
							setCurrentPage(1)
						}}
						className='pl-9'
					/>
				</div>
			)}

			{/* Table */}
			<div className='rounded-md border overflow-x-auto'>
				<Table>
					<TableHeader>
						<TableRow className='bg-muted/50'>
							{columns.map((col) => (
								<TableHead
									key={col.key}
									className={cn(
										col.sortable && sortable && 'cursor-pointer select-none',
										col.width,
									)}
									onClick={() => col.sortable && handleSort(col.key)}
								>
									<div className='flex items-center gap-1'>
										{col.header}
										{col.sortable && <SortIcon columnKey={col.key} />}
									</div>
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{paginated.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className='h-32 text-center text-muted-foreground'
								>
									{emptyState || 'No data found'}
								</TableCell>
							</TableRow>
						) : (
							paginated.map((row) => (
								<TableRow
									key={keyExtractor(row)}
									className={cn(
										onRowClick && 'cursor-pointer hover:bg-muted/50',
										rowClassName?.(row),
									)}
									onClick={() => onRowClick?.(row)}
								>
									{columns.map((col) => (
										<TableCell key={col.key}>
											{col.render ? col.render(row) : String((row as any)[col.key] ?? '—')}
										</TableCell>
									))}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{/* Pagination */}
			{pagination && totalPages > 1 && (
				<div className='flex items-center justify-between'>
					<p className='text-sm text-muted-foreground'>
						Showing {Math.min(filtered.length, (currentPage - 1) * pageSize + 1)} to{' '}
						{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} results
					</p>
					<div className='flex items-center gap-1'>
						<Button
							variant='outline'
							size='sm'
							className='h-8 w-8 p-0'
							onClick={() => setCurrentPage(1)}
							disabled={currentPage === 1}
						>
							<ChevronsLeft className='h-4 w-4' />
						</Button>
						<Button
							variant='outline'
							size='sm'
							className='h-8 w-8 p-0'
							onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
							disabled={currentPage === 1}
						>
							<ChevronLeft className='h-4 w-4' />
						</Button>
						<span className='text-sm px-2'>
							Page {currentPage} of {totalPages}
						</span>
						<Button
							variant='outline'
							size='sm'
							className='h-8 w-8 p-0'
							onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
							disabled={currentPage === totalPages}
						>
							<ChevronRight className='h-4 w-4' />
						</Button>
						<Button
							variant='outline'
							size='sm'
							className='h-8 w-8 p-0'
							onClick={() => setCurrentPage(totalPages)}
							disabled={currentPage === totalPages}
						>
							<ChevronsRight className='h-4 w-4' />
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
