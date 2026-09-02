import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';

export type CalendarPickerProps = {
	value?: Date;
	onChange?: (date: Date) => void;
	minDate?: Date;
	maxDate?: Date;
	showTime?: boolean;
	className?: string;
	disabled?: boolean;
};

const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const months = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

export function CalendarPicker({
	value,
	onChange,
	minDate,
	maxDate,
	showTime = false,
	className,
	disabled,
}: CalendarPickerProps) {
	const [selectedDate, setSelectedDate] = useState(value || new Date());
	const [currentMonth, setCurrentMonth] = useState(selectedDate.getMonth());
	const [currentYear, setCurrentYear] = useState(selectedDate.getFullYear());
	const [hour, setHour] = useState(selectedDate.getHours());
	const [minute, setMinute] = useState(selectedDate.getMinutes());

	const today = new Date();

	const getDaysInMonth = (year: number, month: number) => {
		return new Date(year, month + 1, 0).getDate();
	};

	const getFirstDayOfMonth = (year: number, month: number) => {
		return new Date(year, month, 1).getDay();
	};

	const daysInMonth = getDaysInMonth(currentYear, currentMonth);
	const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
	const daysInPrevMonth = getDaysInMonth(currentYear, currentMonth - 1);

	const handleDateClick = (day: number) => {
		const newDate = new Date(currentYear, currentMonth, day, hour, minute);
		setSelectedDate(newDate);
		onChange?.(newDate);
		trackEvent('calendar_date_selected', {
			date: newDate.toISOString(),
		});
	};

	const prevMonth = () => {
		if (currentMonth === 0) {
			setCurrentMonth(11);
			setCurrentYear(currentYear - 1);
		} else {
			setCurrentMonth(currentMonth - 1);
		}
	};

	const nextMonth = () => {
		if (currentMonth === 11) {
			setCurrentMonth(0);
			setCurrentYear(currentYear + 1);
		} else {
			setCurrentMonth(currentMonth + 1);
		}
	};

	const isDateDisabled = (day: number) => {
		const date = new Date(currentYear, currentMonth, day);
		if (minDate && date < minDate) return true;
		if (maxDate && date > maxDate) return true;
		return false;
	};

	const isSelected = (day: number) => {
		return (
			selectedDate.getDate() === day &&
			selectedDate.getMonth() === currentMonth &&
			selectedDate.getFullYear() === currentYear
		);
	};

	const isToday = (day: number) => {
		return (
			today.getDate() === day &&
			today.getMonth() === currentMonth &&
			today.getFullYear() === currentYear
		);
	};

	const handleTimeChange = (h: number, m: number) => {
		setHour(h);
		setMinute(m);
		const newDate = new Date(selectedDate);
		newDate.setHours(h, m);
		setSelectedDate(newDate);
		onChange?.(newDate);
	};

	return (
		<div className={cn('p-3 rounded-lg border bg-card w-fit', className)}>
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 w-7 p-0"
					onClick={prevMonth}
					disabled={disabled}
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<span className="text-sm font-semibold">
					{months[currentMonth]} {currentYear}
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 w-7 p-0"
					onClick={nextMonth}
					disabled={disabled}
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>

			{/* Day headers */}
			<div className="grid grid-cols-7 gap-1 mb-1">
				{days.map((d) => (
					<div
						key={d}
						className="h-8 w-8 flex items-center justify-center text-xs text-muted-foreground font-medium"
					>
						{d}
					</div>
				))}
			</div>

			{/* Days grid */}
			<div className="grid grid-cols-7 gap-1">
				{/* Previous month padding */}
				{Array.from({ length: firstDay }).map((_, i) => (
					<div
						key={`prev-${i}`}
						className="h-8 w-8 flex items-center justify-center text-xs text-muted-foreground/50"
					>
						{daysInPrevMonth - firstDay + i + 1}
					</div>
				))}

				{/* Current month days */}
				{Array.from({ length: daysInMonth }).map((_, i) => {
					const day = i + 1;
					const disabled = isDateDisabled(day);
					const selected = isSelected(day);
					const isTodayDate = isToday(day);

					return (
						<button
							key={day}
							disabled={disabled || disabled}
							onClick={() => handleDateClick(day)}
							className={cn(
								'h-8 w-8 flex items-center justify-center text-xs rounded-md transition-colors',
								selected
									? 'bg-primary text-primary-foreground font-semibold'
									: isTodayDate
										? 'bg-primary/10 text-primary font-semibold'
										: 'hover:bg-muted',
								disabled && 'opacity-30 cursor-not-allowed',
							)}
						>
							{day}
						</button>
					);
				})}
			</div>

			{/* Time picker */}
			{showTime && (
				<div className="mt-4 pt-4 border-t flex items-center gap-2">
					<Clock className="h-4 w-4 text-muted-foreground" />
					<div className="flex items-center gap-1">
						<select
							value={hour}
							onChange={(e) => handleTimeChange(Number(e.target.value), minute)}
							className="h-8 rounded border bg-background px-2 text-sm"
							disabled={disabled}
						>
							{Array.from({ length: 24 }).map((_, i) => (
								<option key={i} value={i}>
									{i.toString().padStart(2, '0')}
								</option>
							))}
						</select>
						<span className="text-sm">:</span>
						<select
							value={minute}
							onChange={(e) => handleTimeChange(hour, Number(e.target.value))}
							className="h-8 rounded border bg-background px-2 text-sm"
							disabled={disabled}
						>
							{Array.from({ length: 60 }).map((_, i) => (
								<option key={i} value={i}>
									{i.toString().padStart(2, '0')}
								</option>
							))}
						</select>
					</div>
				</div>
			)}
		</div>
	);
}
