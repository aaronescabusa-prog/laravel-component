<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Event;
use App\Models\Registration;
use App\Services\EventEligibility;
use App\Services\EventSchedule;
use App\Services\CompulsoryAttendance;
use App\Support\AcademicStructure;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class EventController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request, bool $archived = false)
    {
        $query = Event::query();
        $archived
            ? $query->whereNotNull('archived_at')
            : $query->whereNull('archived_at');

        // Return a live count instead of trusting the denormalized participants
        // column, which can lag behind registrations created from mobile.
        $query->addSelect([
            'registrations_count' => Registration::query()
                ->selectRaw('COUNT(*)')
                ->where(function ($registrations) {
                    $registrations->whereColumn('registrations.event_id', 'events.id')
                        ->orWhere(function ($legacy) {
                            $legacy->whereNull('registrations.event_id')
                                ->whereColumn('registrations.event', 'events.title');
                        });
                }),
        ]);

        if ($request->user()?->role === 'Student') {
            $query->where('status', 'Approved');
        }


        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('title', 'like', "%{$term}%")
                    ->orWhere('description', 'like', "%{$term}%")
                    ->orWhere('organizer', 'like', "%{$term}%");
            });
        }

        if (
    $request->user()?->role !== 'Student' &&
    $request->filled('status')
) {
    $query->where(
        'status',
        $request->string('status')->toString()
    );
}

        if ($request->filled('category')) {
            $query->where('category', $request->string('category')->toString());
        }

        if ($request->filled('target_role')) {
            $query->where('target_role', $request->string('target_role')->toString());
        }

        return response()->json(
            $query->orderByDesc('event_date')->orderByDesc('id')->paginate(
                $this->perPage($request)
            )
        );
    }

    /** Display the archived events for the administrator. */
    public function archivedIndex(Request $request)
    {
        return $this->index($request, true);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'reference' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('events', 'reference')->whereNull('deleted_at')],
            'title' => ['required', 'string', 'max:255'],
            'category' => ['nullable', 'string', 'max:80'],
            'organizer' => ['nullable', 'string', 'max:255'],
            'event_date' => ['nullable', 'date'],
            'registration_deadline' => ['nullable', 'date'],
            'registration_open' => ['sometimes', 'boolean'],
            'start_time' => ['nullable', 'string', 'max:20'],
            'end_date' => ['nullable', 'date'],
            'end_time' => ['nullable', 'string', 'max:20'],
            'venue' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'banner_url' => ['nullable', 'url', 'max:2048'],
            'budget' => ['nullable', 'integer', 'min:0'],
            'capacity' => ['nullable', 'integer', 'min:0'],
            'participants' => ['nullable', 'integer', 'min:0'],
            'status' => ['sometimes', 'required', 'string', Rule::in(['Draft', 'Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled'])],
            'target_role' => ['sometimes', 'string', Rule::in(['All', 'Admin', 'Student'])],
            'target_course' => ['sometimes', 'nullable', 'string', Rule::in($this->courses())],
            'target_department' => ['sometimes', 'nullable', 'string', Rule::in(array_column(AcademicStructure::DEPARTMENTS, 'code'))],
            'target_year' => ['sometimes', 'nullable', 'string', Rule::in(AcademicStructure::YEARS)],
            'target_block' => ['sometimes', 'nullable', 'string', 'max:50'],
            'has_certificate' => ['sometimes', 'boolean'],
            'penalty_type' => ['sometimes', 'string', 'max:50'],
            'penalty_amount' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'attendance_compulsory' => ['sometimes', 'boolean'],
            'attendance_requires_checkout' => ['sometimes', 'boolean'],
            'absence_fine_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:99999999.99'],
            'incomplete_fine_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:99999999.99'],
            'attendance_correction_deadline' => ['sometimes', 'nullable', 'date'],
            'excuse_deadline' => ['sometimes', 'nullable', 'date'],
        ]);

        $this->validateAudience($request);
        $this->validateSchedule($request);
        $this->validateRegistrationWindow($request);
        $this->validateCompulsoryAudience($request);

        $validated['reference'] ??= $this->nextEventReference();
        $validated['status'] ??= 'Draft';

        // Fill, derive the duration from the start/end range, then save once:
        // duration_value/duration_unit are calculated, never accepted from the
        // client, so they cannot be set to contradict the schedule.
        $event = Event::withTrashed()->where('reference', $validated['reference'])->first()
            ?? new Event;

        // A soft-deleted namesake still holds its unique reference, so revive it
        // rather than colliding with the index (see UserAccountController::persist).
        if ($event->exists && $event->trashed()) {
            $event->restore();
        }

        $event->fill($validated);
        $event->syncDuration();
        $event->save();

        // Every event starts with a morning and an afternoon check-in window so
        // the check-in desk has somewhere to record against. Idempotent, so an
        // event resaved later keeps whatever the registrar has since changed.
        app(EventSchedule::class)->ensureSessions($event);
        if ($event->attendance_compulsory && $event->status === 'Approved') {
            app(CompulsoryAttendance::class)->finalizeRoster($event);
        }

        // Refresh so the response carries every column, not just the ones that
        // were submitted. Without it a field that was left unset (duration, for
        // example) is simply absent from the JSON rather than null, so a create
        // and the subsequent read would disagree on shape. update() does the
        // same.
        return response()->json($event->refresh(), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Event $event)
    {
        if (request()->user()?->role === 'Student' && $event->status !== 'Approved') {
            abort(404);
        }


        return response()->json($event);
    }

    /** Preview whether the signed-in student can register without writing data. */
    public function eligibility(Request $request, Event $event, EventEligibility $eligibility)
    {
        if ($request->user()?->role !== 'Student') {
            return response()->json(['message' => 'Only student accounts can check registration eligibility.'], 403);
        }

        if ($event->status !== 'Approved') {
            return response()->json([
                'event_reference' => $event->reference,
                'can_register' => false,
                'code' => 'not_open',
                'reason' => 'This event is not open for registration.',
            ]);
        }

        if ($event->event_date && $event->event_date->format('Y-m-d') < now()->toDateString()) {
            return response()->json([
                'event_reference' => $event->reference,
                'can_register' => false,
                'code' => 'registration_closed',
                'reason' => 'Registration is closed because the event date has passed.',
            ]);
        }

        $result = $eligibility->check($event, $request->user());

        return response()->json([
            'event_reference' => $event->reference,
            'can_register' => $result['code'] === 'ok',
            ...$result,
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Event $event)
    {
        $validated = $request->validate([
            'reference' => ['sometimes', 'string', 'max:50', Rule::unique('events', 'reference')->ignore($event->id)],
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'category' => ['sometimes', 'nullable', 'string', 'max:80'],
            'organizer' => ['nullable', 'string', 'max:255'],
            'event_date' => ['nullable', 'date'],
            'registration_deadline' => ['sometimes', 'nullable', 'date'],
            'registration_open' => ['sometimes', 'boolean'],
            'start_time' => ['nullable', 'string', 'max:20'],
            'end_date' => ['nullable', 'date'],
            'end_time' => ['nullable', 'string', 'max:20'],
            'venue' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'banner_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'budget' => ['nullable', 'integer', 'min:0'],
            'capacity' => ['nullable', 'integer', 'min:0'],
            'participants' => ['nullable', 'integer', 'min:0'],
            'status' => ['sometimes', 'required', 'string', Rule::in(['Draft', 'Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled'])],
            'target_role' => ['sometimes', 'nullable', 'string', Rule::in(['All', 'Admin', 'Student'])],
            'target_course' => ['sometimes', 'nullable', 'string', Rule::in($this->courses())],
            'target_department' => ['sometimes', 'nullable', 'string', Rule::in(array_column(AcademicStructure::DEPARTMENTS, 'code'))],
            'target_year' => ['sometimes', 'nullable', 'string', Rule::in(AcademicStructure::YEARS)],
            'target_block' => ['sometimes', 'nullable', 'string', 'max:50'],
            'has_certificate' => ['sometimes', 'boolean'],
            'penalty_type' => ['sometimes', 'string', 'max:50'],
            'penalty_amount' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'attendance_compulsory' => ['sometimes', 'boolean'],
            'attendance_requires_checkout' => ['sometimes', 'boolean'],
            'absence_fine_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:99999999.99'],
            'incomplete_fine_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:99999999.99'],
            'attendance_correction_deadline' => ['sometimes', 'nullable', 'date'],
            'excuse_deadline' => ['sometimes', 'nullable', 'date'],
        ]);

        // Compared against the stored values as well, because a partial update
        // may only supply one half of the range.
        $this->validateAudience($request, $event);
        $this->validateSchedule($request, $event);
        $this->validateRegistrationWindow($request, $event);
        $this->validateCompulsoryAudience($request, $event);
        $this->validateFinalizedPolicy($validated, $event);

        $event->fill($validated);
        $event->syncDuration();
        $event->save();

        // An event that predates the check-in feature has no sessions yet, and
        // neither does one just given its first date. Create them on save
        // rather than leaving the check-in desk with nothing to record against.
        app(EventSchedule::class)->ensureSessions($event);
        if ($event->attendance_compulsory && $event->status === 'Approved') {
            app(CompulsoryAttendance::class)->finalizeRoster($event);
        }

        return response()->json($event->refresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Request $request, Event $event)
    {
        $event->delete();

        return response()->noContent();
    }

    /** Archive a completed event without deleting its registrations or reports. */
    public function archive(Event $event)
    {
        if ($event->status !== 'Completed') {
            throw ValidationException::withMessages([
                'status' => 'Only completed events can be archived.',
            ]);
        }

        if ($event->archived_at === null) {
            $event->forceFill(['archived_at' => now()])->save();
        }

        return response()->json($event->refresh());
    }

    /** Restore an event from the archive. */
    public function restore(Event $event)
    {
        if ($event->archived_at !== null) {
            $event->forceFill(['archived_at' => null])->save();
        }

        return response()->json($event->refresh());
    }

    /** Store the event banner uploaded by the web admin or event organizer. */
    public function uploadBanner(Request $request, Event $event)
    {
        $validated = $request->validate([
            'banner' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        $path = $validated['banner']->store('event-banners', 'public');
        $event->forceFill(['banner_url' => Storage::disk('public')->url($path)])->save();

        return response()->json(['banner_url' => $event->fresh()->banner_url]);
    }

    /**
     * Courses an event's visibility can be limited to.
     *
     * @return list<string>
     */
    public function courses(): array
    {
        return AcademicStructure::courses();
    }

    /**
     * The course audiences an event may be aimed at, for the picker.
     */
    public function coursesIndex()
    {
        return response()->json([
            'courses' => $this->courses(),
            'departments' => AcademicStructure::DEPARTMENTS,
            'years' => AcademicStructure::YEARS,
        ]);
    }

    /**
     * A selected program must belong to the selected department.
     */
    protected function validateAudience(Request $request, ?Event $event = null): void
    {
        $department = $request->exists('target_department')
            ? $request->input('target_department')
            : $event?->target_department;
        $course = $request->exists('target_course')
            ? $request->input('target_course')
            : $event?->target_course;

        if ($department && $course && ! in_array($course, AcademicStructure::coursesForDepartment($department), true)) {
            throw ValidationException::withMessages([
                'target_course' => ['The selected program does not belong to the selected department.'],
            ]);
        }
    }

    /**
     * An event cannot finish before it starts.
     *
     * Checked separately because it spans two fields, and skipped when either
     * is absent so a partially filled form still saves. On update the stored
     * value stands in for a half the request did not send.
     */
    protected function validateSchedule(Request $request, ?Event $event = null): void
    {
        $start = $request->exists('event_date')
            ? $request->input('event_date')
            : $event?->event_date?->format('Y-m-d');

        $end = $request->exists('end_date')
            ? $request->input('end_date')
            : $event?->end_date?->format('Y-m-d');

        if (! $start || ! $end) {
            return;
        }

        if (Carbon::parse($end)->startOfDay()->lt(Carbon::parse($start)->startOfDay())) {
            throw ValidationException::withMessages([
                'end_date' => 'The end date cannot be before the start date.',
            ]);
        }
    }

    /** A registration cutoff cannot fall after the event begins. */
    protected function validateRegistrationWindow(Request $request, ?Event $event = null): void
    {
        $deadline = $request->exists('registration_deadline')
            ? $request->input('registration_deadline')
            : $event?->registration_deadline?->format('Y-m-d');
        $eventDate = $request->exists('event_date')
            ? $request->input('event_date')
            : $event?->event_date?->format('Y-m-d');

        if ($deadline && $eventDate && Carbon::parse($deadline)->gt(Carbon::parse($eventDate))) {
            throw ValidationException::withMessages([
                'registration_deadline' => ['The registration deadline cannot be after the event start date.'],
            ]);
        }
    }

    /** Audience and policy edits after roster finalization would rewrite history. */
    protected function validateFinalizedPolicy(array $validated, Event $event): void
    {
        if (! $event->attendance_roster_finalized_at && ! $event->attendanceObligations()->exists()) return;

        foreach ([
            'target_role', 'target_course', 'target_department', 'target_year', 'target_block',
            'attendance_compulsory', 'attendance_requires_checkout', 'absence_fine_amount',
            'incomplete_fine_amount', 'attendance_correction_deadline', 'excuse_deadline',
        ] as $field) {
            if (! array_key_exists($field, $validated)) continue;
            $current = $event->getAttribute($field);
            $incoming = $validated[$field];
            if (in_array($field, ['attendance_correction_deadline', 'excuse_deadline'], true)) {
                $current = $current ? Carbon::parse($current)->format('Y-m-d H:i:s') : null;
                $incoming = $incoming ? Carbon::parse($incoming)->format('Y-m-d H:i:s') : null;
            }
            if (in_array($field, ['absence_fine_amount', 'incomplete_fine_amount'], true)) {
                $current = $current === null ? null : (float) $current;
                $incoming = $incoming === null ? null : (float) $incoming;
            }
            if (is_bool($current)) $incoming = (bool) $incoming;
            if ((string) ($current ?? '') !== (string) ($incoming ?? '')) {
                throw ValidationException::withMessages([$field => 'The attendance roster and policy are locked after finalization.']);
            }
        }
    }

    protected function validateCompulsoryAudience(Request $request, ?Event $event = null): void
    {
        $compulsory = $request->exists('attendance_compulsory')
            ? $request->boolean('attendance_compulsory')
            : (bool) $event?->attendance_compulsory;
        $targetRole = $request->exists('target_role')
            ? $request->input('target_role')
            : ($event?->target_role ?? 'All');

        if ($compulsory && $targetRole === 'Admin') {
            throw ValidationException::withMessages([
                'target_role' => ['Compulsory attendance rosters can only include students.'],
            ]);
        }
    }

    private function nextEventReference(): string
    {
        do {
            $reference = 'EVT-'.Str::upper(Str::random(12));
        } while (Event::withTrashed()->where('reference', $reference)->exists());

        return $reference;
    }
}
