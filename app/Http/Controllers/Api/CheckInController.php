<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\AttendanceSession;
use App\Models\Event;
use App\Models\Registration;
use App\Services\AttendanceRecorder;
use App\Services\EventScannerAccess;
use App\Services\EventSchedule;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The check-in desk.
 *
 * Web staff select an event and mobile scanners load assigned events. The
 * event check-in token identifies which event is being handled; every endpoint
 * still requires an authenticated account with permission for that event.
 */
class CheckInController extends Controller
{
    public const MAX_BATCH = 500;

    public function __construct(
        private readonly AttendanceRecorder $recorder,
        private readonly EventSchedule $schedule,
        private readonly EventScannerAccess $scannerAccess,
    ) {
    }

    /**
     * The event behind a check-in token, with its sessions and full roster.
     *
     * Resolved by token alone so a scanner never has to send an event id, which
     * is the whole point of printing a poster.
     */
    public function show(Request $request, string $token)
    {
        $event = Event::where('checkin_token', $token)->firstOrFail();
        $this->scannerAccess->authorize($request->user(), $event);

        return response()->json($this->rosterPayload($event));
    }

    /**
     * Check-in token and canonical URL for an event.
     */
    public function poster(Event $event)
    {
        if (! $event->checkin_token) {
            $event->forceFill(['checkin_token' => bin2hex(random_bytes(16))])->save();
        }

        return response()->json([
            'event' => [
                'reference' => $event->reference,
                'title' => $event->title,
                'event_date' => $event->event_date?->format('Y-m-d'),
                'venue' => $event->venue,
            ],
            'token' => $event->checkin_token,
            'url' => url('/attendance/check-in/'.$event->checkin_token),
        ]);
    }

    /**
     * Punch a roster in or out for one session.
     */
    public function punch(Request $request, string $token)
    {
        $validated = $request->validate([
            'session_id' => ['required', 'integer'],
            'direction' => ['required', Rule::in(['in', 'out'])],
            'registration_ids' => ['required', 'array', 'min:1', 'max:'.self::MAX_BATCH],
            'registration_ids.*' => ['required', 'integer'],
            'at' => ['nullable', 'date'],
        ]);

        $event = Event::where('checkin_token', $token)->firstOrFail();
        $this->scannerAccess->authorize($request->user(), $event);

        $session = $this->sessionFor($event, (int) $validated['session_id']);

        // Scoped to the event so a token for one event cannot punch the roster
        // of another by posting its ids.
        $registrations = $event->registrations()
            ->whereIn('id', $validated['registration_ids'])
            ->get();

        if ($registrations->count() !== count(array_unique($validated['registration_ids']))) {
            return response()->json([
                'message' => 'One or more participants do not belong to this event.',
            ], 422);
        }

        $result = $this->recorder->punchMany(
            $session,
            $registrations,
            $validated['direction'],
            $validated['at'] ? CarbonImmutable::parse($validated['at']) : null,
            $this->actor($request),
            $request->user()->getKey(),
        );

        return response()->json([
            'message' => $validated['direction'] === 'in'
                ? 'Checked in '.$result['punched']->count().' participant(s).'
                : 'Checked out '.$result['punched']->count().' participant(s).',
            'session' => $this->sessionPayload($session->refresh()),
            'punched' => $result['punched']->pluck('registration_id'),
            'skipped' => $result['skipped'],
        ], $result['skipped'] === [] ? 200 : 207);
    }

    /**
     * Record a mobile scan of one student's event pass.
     */
    public function scan(Request $request, string $token)
    {
        $validated = $request->validate([
            'qr_code' => ['required', 'string', 'max:100'],
            'session_id' => ['required', 'integer'],
            'direction' => ['required', Rule::in(['in', 'out'])],
        ]);

        $event = Event::where('checkin_token', $token)->firstOrFail();
        $this->scannerAccess->authorize($request->user(), $event);
        $session = $this->sessionFor($event, (int) $validated['session_id']);

        $registrations = $event->registrations()
            ->where('qr_code', $validated['qr_code'])
            ->limit(2)
            ->get();

        if ($registrations->isEmpty()) {
            abort(404, 'This student pass is not registered for this event.');
        }

        if ($registrations->count() > 1) {
            throw ValidationException::withMessages([
                'qr_code' => 'This pass is linked to multiple registrations for this event.',
            ]);
        }

        $registration = $registrations->first();
        $result = $this->recorder->punchMany(
            $session,
            [$registration],
            $validated['direction'],
            null,
            $this->actor($request),
            $request->user()->getKey(),
        );
        $punch = $result['punched']->first();

        return response()->json([
            'message' => $punch
                ? 'Checked '.$validated['direction'].' '.$registration->participant.'.'
                : ($result['skipped'][$registration->reference] ?? 'The scan was not recorded.'),
            'registration' => [
                'reference' => $registration->reference,
                'participant' => $registration->participant,
            ],
            'session' => $this->sessionPayload($session->refresh()),
            'attendance' => $punch ? [
                'status' => $punch->status,
                'time_in' => $punch->time_in,
                'time_out' => $punch->time_out,
            ] : null,
            'skipped' => $result['skipped'],
        ], $result['skipped'] === [] ? 200 : 207);
    }

    /**
     * Mark participants Absent or Excused without a punch.
     */
    public function mark(Request $request, string $token)
    {
        $validated = $request->validate([
            'session_id' => ['required', 'integer'],
            'status' => ['required', Rule::in([Attendance::ABSENT, Attendance::EXCUSED])],
            'registration_ids' => ['required', 'array', 'min:1', 'max:'.self::MAX_BATCH],
            'registration_ids.*' => ['required', 'integer'],
        ]);

        $event = Event::where('checkin_token', $token)->firstOrFail();
        $this->scannerAccess->authorize($request->user(), $event);
        $session = $this->sessionFor($event, (int) $validated['session_id']);

        $requested = collect($validated['registration_ids'])->map(fn ($id) => (int) $id)->unique();
        $registrations = $event->registrations()->whereIn('id', $requested)->get();

        // Reject rather than quietly marking a subset. A stale roster left open
        // in the browser must not mark some participants and silently skip the
        // rest, which would look like success while leaving records wrong.
        if ($registrations->count() !== $requested->count()) {
            throw ValidationException::withMessages([
                'registration_ids' => 'These participants are not on this event: '
                    .$requested->diff($registrations->pluck('id'))->implode(', ')
                    .'. Reload the roster and try again.',
            ]);
        }

        $marked = 0;

        foreach ($registrations as $registration) {
            $this->recorder->mark($session, $registration, $validated['status'], $this->actor($request), $request->user()->getKey());
            $marked++;
        }

        return response()->json([
            'message' => 'Marked '.$marked.' participant(s) as '.$validated['status'].'.',
            'session' => $this->sessionPayload($session->refresh()),
        ]);
    }

    /* ------------------------------------------------------------------ *
     *  Session administration
     * ------------------------------------------------------------------ */

    public function sessions(Event $event)
    {
        return response()->json([
            'event' => $event->reference,
            'sessions' => $event->attendanceSessions()->get()->map(fn ($s) => $this->sessionPayload($s)),
        ]);
    }

    /**
     * Create the morning / afternoon pair if the event has none yet.
     */
    public function ensureSessions(Request $request, Event $event)
    {
        $this->schedule->ensureSessions($event);

        return response()->json([
            'message' => 'Sessions are ready.',
            'sessions' => $event->attendanceSessions()->get()->map(fn ($s) => $this->sessionPayload($s)),
        ]);
    }

    public function storeSession(Request $request, Event $event)
    {
        $rules = $this->schedule->rules();
        $rules['label'] = ['required', 'string', 'max:60', Rule::unique('attendance_sessions', 'label')
            ->where(fn ($query) => $query->where('event_id', $event->id)->where('session_date', $request->input('session_date')))];

        $validated = $request->validate($rules);

        $validated['event_id'] = $event->id;
        $validated['status'] = 'open';
        $validated['created_by'] = $this->actor($request);
        $validated['grace_minutes'] ??= 15;
        $validated['session_date'] = CarbonImmutable::parse($validated['session_date'])->format('Y-m-d');

        $session = AttendanceSession::create($validated);

        return response()->json($this->sessionPayload($session), 201);
    }

    public function updateSession(Request $request, AttendanceSession $session)
    {
        $request->validate([
            'label' => ['sometimes', 'required', 'string', 'max:60'],
            'session_date' => ['sometimes', 'required', 'date'],
            'time_in' => ['nullable', 'regex:'.EventSchedule::TIME_PATTERN],
            'time_out' => ['nullable', 'regex:'.EventSchedule::TIME_PATTERN],
            'grace_minutes' => ['nullable', 'integer', 'min:0', 'max:240'],
        ]);

        $session = $this->schedule->updateWindow(
            $session->refresh(),
            $request->input('time_in'),
            $request->input('time_out'),
        );

        if ($request->filled('label')) {
            $session->update(['label' => $request->string('label')->toString()]);
        }

        if ($request->has('grace_minutes')) {
            $session->update(['grace_minutes' => $request->integer('grace_minutes')]);
        }

        return response()->json($this->sessionPayload($session->refresh()));
    }

    public function closeSession(Request $request, AttendanceSession $session)
    {
        $this->schedule->close($session, $this->actor($request));

        // Everyone still checked in when the session closes must have their
        // roll-up brought up to date, or the roster would show them as absent.
        $session->attendances()
            ->with('registration')
            ->get()
            ->each(fn (Attendance $a) => $a->registration
                && $this->recorder->syncRollup($a->registration));

        return response()->json($this->sessionPayload($session->refresh()));
    }

    public function reopenSession(AttendanceSession $session)
    {
        $this->schedule->reopen($session);

        return response()->json($this->sessionPayload($session->refresh()));
    }

    /* ------------------------------------------------------------------ *
     *  Internals
     * ------------------------------------------------------------------ */

    /**
     * Build the whole check-in view in a fixed number of queries.
     */
    private function rosterPayload(Event $event): array
    {
        $event->loadMissing('attendanceSessions');

        $sessions = $event->attendanceSessions;
        $sessionIds = $sessions->pluck('id');

        $registrations = $event->registrations()
            ->with('userAccount:id,course,year,block_no')
            ->orderBy('participant')
            ->get();

        $punches = DB::table('attendances')
            ->whereIn('attendance_session_id', $sessionIds)
            ->whereIn('registration_id', $registrations->pluck('id'))
            ->get(['attendance_session_id', 'registration_id', 'time_in', 'time_out', 'status'])
            ->keyBy(fn ($row) => $row->attendance_session_id.':'.$row->registration_id);

        $roster = $registrations->map(function (Registration $registration) use ($sessions, $punches) {
            $perSession = [];

            foreach ($sessions as $session) {
                $punch = $punches->get($session->id.':'.$registration->id);

                $perSession[(string) $session->id] = [
                    'time_in' => $punch?->time_in,
                    'time_out' => $punch?->time_out,
                    'status' => $punch?->status ?? Attendance::NOT_RECORDED,
                    'complete' => $punch !== null && $punch->time_in !== null && $punch->time_out !== null,
                ];
            }

            $complete = collect($perSession)->filter(fn ($s) => $s['complete'])->count();

            return [
                'registration_id' => $registration->id,
                'reference' => $registration->reference,
                'participant' => $registration->participant,
                'email' => $registration->email,
                'role' => $registration->role,
                'department' => $registration->userAccount?->department,
                'department_name' => $registration->userAccount?->department_name,
                'course' => $registration->userAccount?->course,
                'year' => $registration->userAccount?->year,
                'block_no' => $registration->block_no ?: $registration->userAccount?->block_no,
                'attendance' => $registration->attendance,
                'sessions_complete' => $complete,
                'sessions_total' => $sessions->count(),
                'sessions' => $perSession,
            ];
        })->values();

        return [
            'event' => [
                'reference' => $event->reference,
                'title' => $event->title,
                'event_date' => $event->event_date?->format('Y-m-d'),
                'venue' => $event->venue,
            ],
            'sessions' => $sessions->map(fn ($s) => $this->sessionPayload($s)),
            'roster' => $roster,
            'counts' => [
                'registered' => $roster->count(),
                'fully_recorded' => $roster->filter(fn ($r) => $r['sessions_complete'] === $r['sessions_total'] && $r['sessions_total'] > 0)->count(),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function sessionPayload(AttendanceSession $session): array
    {
        return [
            'id' => $session->id,
            'event_id' => $session->event_id,
            'label' => $session->label,
            'session_date' => $session->session_date?->format('Y-m-d'),
            'time_in' => $session->time_in,
            'time_out' => $session->time_out,
            'grace_minutes' => $session->grace_minutes,
            'status' => $session->status,
            'open' => $session->isOpen(),
            'late_after' => $session->lateAfter()?->toDateTimeString(),
        ];
    }

    /**
     * Fetch a session and prove it belongs to the event the token names.
     */
    private function sessionFor(Event $event, int $sessionId): AttendanceSession
    {
        $session = AttendanceSession::where('event_id', $event->id)->find($sessionId);

        if (! $session) {
            abort(404, 'That session does not belong to this event.');
        }

        return $session;
    }

    private function actor(Request $request): ?string
    {
        $user = $request->user();

        return $user?->name ?? $user?->email;
    }
}
