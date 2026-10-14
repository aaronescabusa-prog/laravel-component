<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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
        abort_unless($scanner->role === 'Scanner', 403, 'Scanner access is required.');

        $events = $scanner->scannerEvents()
            ->where('events.status', 'Approved')
            ->orderBy('events.event_date')
            ->orderBy('events.title')
            ->get([
                'events.id',
                'events.reference',
                'events.title',
                'events.organizer',
                'events.event_date',
                'events.start_time',
                'events.end_date',
                'events.end_time',
                'events.duration_value',
                'events.duration_unit',
                'events.venue',
                'events.status',
                'events.checkin_token',
            ]);

        $events->each(fn (Event $event) => $event->makeVisible('checkin_token'));

        return response()->json($events);
    }
}
