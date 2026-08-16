import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Bookmark, Briefcase, FileText, MessageCircle, Trophy } from 'lucide-react'
import type { KanbanApplication, KanbanItem } from './kanban-card'
import { KanbanCard } from './kanban-card'

export interface KanbanColumnDef {
	id: string
	title: string
	icon: typeof FileText
	color: string
	bgColor: string
	borderColor: string
	emptyText: string
	emptySubtext: string
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
	{
		id: 'saved',
		title: 'Saved',
		icon: Bookmark,
		color: 'text-slate-700',
		bgColor: 'bg-slate-50',
		borderColor: 'border-slate-200',
		emptyText: 'No saved jobs yet',
		emptySubtext: 'Save jobs from the job board to track them here',
	},
	{
		id: 'applied',
		title: 'Applied',
		icon: FileText,
		color: 'text-indigo-700',
		bgColor: 'bg-indigo-50/60',
		borderColor: 'border-indigo-200',
		emptyText: 'No applications yet',
		emptySubtext: 'Apply to jobs and they will appear here',
	},
	{
		id: 'in_discussion',
		title: 'In Discussion',
		icon: MessageCircle,
		color: 'text-amber-700',
		bgColor: 'bg-amber-50/60',
		borderColor: 'border-amber-200',
		emptyText: 'Nothing in discussion',
		emptySubtext: 'Applications under review will show here',
	},
	{
		id: 'offer_received',
		title: 'Offer Received',
		icon: Trophy,
		color: 'text-emerald-700',
		bgColor: 'bg-emerald-50/60',
		borderColor: 'border-emerald-200',
		emptyText: 'No offers yet',
		emptySubtext: 'Offers and hires will appear here',
	},
]

interface KanbanColumnProps {
	column: KanbanColumnDef
	items: KanbanItem[]
	onCardClick: (item: KanbanItem) => void
	onStartOutreach?: (app: KanbanApplication) => void
}

export function KanbanColumn({ column, items, onCardClick, onStartOutreach }: KanbanColumnProps) {
	const { setNodeRef, isOver } = useDroppable({
		id: column.id,
		data: { columnId: column.id },
	})

	const Icon = column.icon

	return (
		<div
			ref={setNodeRef}
			className={`flex flex-col rounded-xl border-2 transition-colors min-w-[280px] w-[280px] sm:w-[300px] flex-shrink-0 ${
				isOver ? 'border-indigo-400 bg-indigo-50/30' : column.borderColor
			} ${column.bgColor}`}
		>
			{/* Header */}
			<div className='flex items-center justify-between px-4 py-3 border-b border-black/5'>
				<div className='flex items-center gap-2'>
					<Icon className={`h-4 w-4 ${column.color}`} />
					<h3 className='font-semibold text-sm'>{column.title}</h3>
				</div>
				<span className='flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-white text-xs font-medium shadow-sm px-2'>
					{items.length}
				</span>
			</div>

			{/* Cards */}
			<div className='flex-1 p-3 space-y-2 min-h-[120px]'>
				{items.length === 0 ? (
					<div className='flex flex-col items-center justify-center py-8 text-center'>
						<Icon className='h-8 w-8 text-muted-foreground/30 mb-2' />
						<p className='text-xs font-medium text-muted-foreground'>{column.emptyText}</p>
						<p className='text-[10px] text-muted-foreground/60 mt-1 max-w-[200px]'>
							{column.emptySubtext}
						</p>
					</div>
				) : (
					<SortableContext
						items={items.map((item) =>
							item.type === 'application' ? `app-${item.data.id}` : `saved-${item.data.id}`
						)}
						strategy={verticalListSortingStrategy}
					>
						{items.map((item) => (
							<KanbanCard
								key={item.type === 'application' ? `app-${item.data.id}` : `saved-${item.data.id}`}
								item={item}
								columnId={column.id}
								onClick={() => onCardClick(item)}
								onStartOutreach={onStartOutreach}
							/>
						))}
					</SortableContext>
				)}
			</div>
		</div>
	)
}
