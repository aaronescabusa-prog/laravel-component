<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Event;
use App\Models\UserAccount;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class EventScannerController extends Controller
{
    public function index(Event $event)
    {
        return response()->json([
            'scanners' => UserAccount::query()
                ->where('role', 'Scanner')
                ->orderBy('name')
                ->get(['id', 'reference', 'name', 'email', 'status']),
            'assigned' => $event->scannerAccounts()->pluck('user_accounts.id'),
        ]);
    }

    public function update(Request $request, Event $event)
    {
        $validated = $request->validate([
            'scanner_ids' => ['present', 'array', 'max:500'],
            'scanner_ids.*' => [
                'required',
                'integer',
                'distinct',
                Rule::exists('user_accounts', 'id')->where(
                    fn ($query) => $query->where('role', 'Scanner')
                        ->where('status', 'Active')
                        ->whereNull('deleted_at')
                ),
            ],
        ]);

        $ids = array_map('intval', $validated['scanner_ids']);
        $assignedBy = $request->user()->getKey();

        DB::transaction(function () use ($event, $ids, $assignedBy) {
            $event->scannerAccounts()->sync(collect($ids)->mapWithKeys(
                fn (int $id) => [$id => ['assigned_by' => $assignedBy]]
            )->all());
        });

        return $this->index($event->refresh());
    }

    public function assignedEvents(Request $request)
    {
        $scanner = $request->user();
        abort_unless(in_array($scanner->role, ['Admin', 'Scanner'], true), 403, 'Scanner access is required.');

        $events = Event::query()
            ->when($scanner->role === 'Scanner', fn ($query) => $query->whereHas(
                'scannerAccounts',
                fn ($accounts) => $accounts->where('user_accounts.id', $scanner->getKey()),
            ))
            ->where('status', 'Approved')
            ->orderBy('events.event_date')
            ->orderBy('events.title')
            ->get([
                'id', 'reference', 'title', 'organizer', 'event_date',
                'start_time', 'end_date', 'end_time', 'duration_value',
                'duration_unit', 'venue', 'status', 'checkin_token',
            ]);

        $events->each(fn (Event $event) => $event->makeVisible('checkin_token'));

        return response()->json($events);
    }

    /** Return attendance actions recorded by the signed-in scanner. */
    public function history(Request $request)
    {
        $scanner = $request->user();
        abort_unless($scanner->role === 'Scanner', 403, 'Scanner access is required.');

        $query = Attendance::query()
            ->where('recorded_by_user_id', $scanner->getKey())
            ->with(['registration:id,reference,participant,email,event_id', 'session:id,event_id,label,session_date'])
            ->whereHas('session.event.scannerAccounts', fn ($query) => $query->where('user_accounts.id', $scanner->id));

        if ($request->filled('event_reference')) {
            $query->whereHas('session.event', fn ($event) => $event->where('reference', $request->string('event_reference')->toString()));
        }

        return response()->json($query->orderByDesc('recorded_at')->paginate($this->perPage($request)));
    }

    /** Daily counts used by the scanner's mobile dashboard. */
    public function summary(Request $request)
    {
        $scanner = $request->user();
        abort_unless($scanner->role === 'Scanner', 403, 'Scanner access is required.');

        $today = now()->toDateString();
        $records = Attendance::query()
            ->where('recorded_by_user_id', $scanner->getKey())
            ->whereDate('recorded_at', $today)
            ->whereHas('session.event.scannerAccounts', fn ($query) => $query->where('user_accounts.id', $scanner->id));

        $eventsToday = (clone $records)
            ->join('attendance_sessions as daily_sessions', 'attendances.attendance_session_id', '=', 'daily_sessions.id')
            ->distinct()
            ->count('daily_sessions.event_id');

        return response()->json([
            'date' => $today,
            'scans_today' => (clone $records)->count(),
            'events_today' => $eventsToday,
            'participants_today' => (clone $records)->distinct('registration_id')->count('registration_id'),
        ]);
    }
}
