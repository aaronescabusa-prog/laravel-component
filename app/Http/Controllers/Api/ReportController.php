<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Certificate;
use App\Models\Evaluation;
use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    /**
     * Aggregate report data across events, registrations, and finances.
     * Supports an optional date range applied to the event date.
     */
    public function index(Request $request)
    {
        $events = Event::query()
            ->when($request->filled('from'), fn ($q) => $q->whereDate('event_date', '>=', $request->string('from')->toString()))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('event_date', '<=', $request->string('to')->toString()))
            // The event filter narrows the event set itself rather than the rows
            // beneath it: matching on the title at this level keeps the id-based
            // grouping below meaningful, where filtering registrations by title
            // could not be reconciled back to a single event.
            ->when($request->filled('event'), fn ($q) => $q->where('title', $request->string('event')->toString()))
            ->orderByDesc('event_date')
            ->get();

        $eventIds = $events->pluck('id');

        $registrationStats = $this->groupedAggregates($eventIds, 'SUM(CASE WHEN payment_status = \'Paid\' THEN 1 ELSE 0 END) AS paid, SUM(CASE WHEN payment_status = \'Pending\' THEN 1 ELSE 0 END) AS pending');
        $attendanceStats = $this->groupedAggregates($eventIds, 'SUM(CASE WHEN attendance = \'Present\' THEN 1 ELSE 0 END) AS present');
        $incomeByEvent = $this->incomeByEvent($eventIds);

        $eventRows = $events->map(fn (Event $event) => [
            'reference' => $event->reference,
            'title' => $event->title,
            'category' => $event->category,
            'organizer' => $event->organizer,
            'status' => $event->status,
            'event_date' => $event->event_date?->format('Y-m-d'),
            'venue' => $event->venue,
            'banner_url' => $event->banner_url,
            'budget' => $event->budget,
            'capacity' => $event->capacity,
            'participants' => $event->participants,
        ]);

        $registrationData = $events->map(fn (Event $event) => $this->registrationBreakdown($event, $registrationStats));
        $attendanceData = $events->map(fn (Event $event) => $this->attendanceBreakdown($event, $attendanceStats));
        $financialData = $events->map(fn (Event $event) => $this->financialBreakdown($event, $incomeByEvent));

        return response()->json([
            'events' => $eventRows,
            'registrations' => $registrationData,
            'attendance' => $attendanceData,
            'financial' => $financialData,
            'summary' => $this->scopedSummary($events, $request),
        ]);
    }

    /**
     * The summary block for a report, counted over the report's own events.
     *
     * This is deliberately not the Dashboard's summary(): that one counts the
     * whole table, which is right for a dashboard and wrong here, where every
     * other block in the response is narrowed by the requested date range. A
     * report filtered to September must not report the event total for all of
     * time beside it.
     *
     * Evaluations are still matched by event title because the evaluations
     * table has no event_id foreign key; see add_event_id_to_event_scoped_tables,
     * which deliberately covered only registrations, certificates and templates.
     */
    private function scopedSummary($events, Request $request): array
    {
        $eventIds = $events->pluck('id');
        $titles = $events->pluck('title');

        $registrations = Registration::query()
            ->whereIn('event_id', $eventIds)
            ->selectRaw("SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) AS paid, SUM(CASE WHEN payment_status = 'Pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN attendance = 'Present' THEN 1 ELSE 0 END) AS attended, COUNT(*) AS total")
            ->first();

        $certificates = Certificate::query()
            ->whereIn('event_id', $eventIds)
            ->selectRaw('status, COUNT(*) AS total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $evaluations = Evaluation::query()->whereIn('event', $titles);

        return [
            // Accounts are not scoped to an event, so this stays global.
            'users' => UserAccount::count(),
            'events' => $events->count(),
            'events_active' => $events->whereIn('status', ['Approved', 'Pending'])->count(),
            'events_pending' => $events->where('status', 'Pending')->count(),
            'registrations' => (int) ($registrations->total ?? 0),
            'registrations_paid' => (int) ($registrations->paid ?? 0),
            'registrations_pending_payment' => (int) ($registrations->pending ?? 0),
            'registrations_attended' => (int) ($registrations->attended ?? 0),
            'certificates_issued' => (int) ($certificates['Issued'] ?? 0),
            'certificates_pending' => (int) ($certificates['Pending'] ?? 0),
            'certificates_total' => (int) $certificates->sum(),
            'certificates_not_eligible' => (int) ($certificates['Not Eligible'] ?? 0),
            'evaluations' => (clone $evaluations)->count(),
            'avg_rating' => round((float) (clone $evaluations)->avg('rating'), 1),
        ];
    }

    /**
     * Dashboard summary in one request.
     *
     * The dashboard used to fan out six per_page=all listings just to count
     * rows. Those full-table downloads are now a single aggregate query set;
     * upcoming events and recent activity still come from their own
     * lightweight endpoints (see below).
     */
    public function summary(Request $request)
    {
        $statuses = Event::query()
            ->selectRaw('status, COUNT(*) AS total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $certificates = Certificate::query()
            ->selectRaw('status, COUNT(*) AS total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $registrations = Registration::query()
            ->selectRaw("SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) AS paid, SUM(CASE WHEN payment_status = 'Pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN attendance = 'Present' THEN 1 ELSE 0 END) AS attended, COUNT(*) AS total")
            ->first();

        return [
            'users' => UserAccount::count(),
            'events' => Event::count(),
            'events_active' => (int) ($statuses['Approved'] ?? 0) + (int) ($statuses['Pending'] ?? 0),
            'events_pending' => (int) ($statuses['Pending'] ?? 0),
            'registrations' => (int) ($registrations->total ?? 0),
            'registrations_paid' => (int) ($registrations->paid ?? 0),
            'registrations_pending_payment' => (int) ($registrations->pending ?? 0),
            'registrations_attended' => (int) ($registrations->attended ?? 0),
            'certificates_issued' => (int) ($certificates['Issued'] ?? 0),
            'certificates_pending' => (int) ($certificates['Pending'] ?? 0),
            'certificates_total' => Certificate::count(),
            'certificates_not_eligible' => (int) ($certificates['Not Eligible'] ?? 0),
            'evaluations' => Evaluation::count(),
            'evaluations_events' => (int) Evaluation::distinct()->count('event'),
            'avg_rating' => round((float) Evaluation::avg('rating'), 1),
        ];
    }

    /**
     * Run a GROUP BY aggregation over the registrations of the given events,
     * keyed by event id.
     *
     * Grouping on event_id rather than the event title is what keeps two events
     * that share a name from merging into one row, and keeps a report correct
     * after an event is renamed. Registrations whose event_id is null are left
     * out: the backfill treats an unmatched title as an orphan for a human to
     * resolve, and guessing it into a same-named event is what produced the
     * merged figures this replaces.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $eventIds
     */
    private function groupedAggregates($eventIds, string $extra)
    {
        return Registration::query()
            ->whereIn('event_id', $eventIds)
            ->selectRaw('event_id, COUNT(*) AS registered, '.$extra)
            ->groupBy('event_id')
            ->get()
            ->keyBy('event_id');
    }

    /**
     * Compute the total income per event id from paid registrations only.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $eventIds
     */
    private function incomeByEvent($eventIds)
    {
        return Registration::query()
            ->whereIn('event_id', $eventIds)
            ->where('payment_status', 'Paid')
            ->get(['event_id', 'payment'])
            ->groupBy('event_id')
            ->map(fn ($rows) => $rows->sum(fn (Registration $row) => $this->parseAmount($row->payment)));
    }

    private function registrationBreakdown(Event $event, $stats): array
    {
        $row = $stats->get($event->id);
        $registered = $row ? (int) $row->registered : 0;

        return [
            'event' => $event->title,
            'registered' => $registered,
            'paid' => $row ? (int) $row->paid : 0,
            'pending' => $row ? (int) $row->pending : 0,
            'capacity' => $event->capacity,
            // null, not 0, when the event is uncapped: a zero fill rate reads as
            // "nobody registered", which is the opposite of "no limit set".
            'fill_rate' => $event->hasCapacity()
                ? (int) round(($registered / $event->capacity) * 100)
                : null,
        ];
    }

    private function attendanceBreakdown(Event $event, $stats): array
    {
        $row = $stats->get($event->id);
        $registered = $row ? (int) $row->registered : 0;
        $present = $row ? (int) $row->present : 0;

        return [
            'event' => $event->title,
            'registered' => $registered,
            'present' => $present,
            'rate' => $registered > 0 ? (int) round(($present / $registered) * 100) : 0,
        ];
    }

    private function financialBreakdown(Event $event, $incomeByEvent): array
    {
        $income = (int) ($incomeByEvent->get($event->id, 0) ?? 0);
        $expenses = (int) $event->budget;
        $net = $income - $expenses;

        return [
            'event' => $event->title,
            'income' => $income,
            'expenses' => $expenses,
            'net' => $net,
        ];
    }

    /**
     * Parse an amount stored as a display string, e.g. "₱150.00" or "Free".
     */
    private function parseAmount(?string $amount): int
    {
        if ($amount === null) {
            return 0;
        }

        $clean = preg_replace('/[^0-9.]/', '', $amount);

        return $clean === '' ? 0 : (int) round((float) $clean);
    }
}
