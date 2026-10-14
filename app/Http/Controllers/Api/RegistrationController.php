<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SendEventReminderJob;
use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use App\Services\EventEligibility;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class RegistrationController extends Controller
{
    /**
     * Roles a registration may carry, matching the user account roles.
     */
    private const ROLES = ['Admin', 'Staff', 'Organizer', 'Student'];

    /**
     * Role applied when a registration does not specify one.
     */
    private const DEFAULT_ROLE = 'Student';

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Registration::query();

        if ($request->user()?->role === 'Student') {
            $query->whereRaw('LOWER(email) = ?', [mb_strtolower(trim($request->user()->email))]);
        }

        if ($request->user()?->role === 'Organizer') {
            $query->whereHas('eventRelation', fn ($event) => $event->where('organizer_user_id', $request->user()->getKey()));
        }

        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('participant', 'like', "%{$term}%")
                    ->orWhere('email', 'like', "%{$term}%")
                    ->orWhere('reference', 'like', "%{$term}%");
            });
        }

        if ($request->filled('event')) {
            $query->where('event', $request->string('event')->toString());
        }

        if ($request->filled('event_reference')) {
            $query->whereHas('eventRelation', fn ($event) => $event->where('reference', $request->string('event_reference')->toString()));
        }

        if ($request->filled('payment_status')) {
            $query->where('payment_status', $request->string('payment_status')->toString());
        }

        if ($request->filled('attendance')) {
            $query->where('attendance', $request->string('attendance')->toString());
        }

        return response()->json($query->orderByDesc('id')->paginate(
            $this->perPage($request)
        ));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request, EventEligibility $eligibility)
    {
        $validated = $request->validate([
            'reference' => ['required', 'string', 'max:50', Rule::unique('registrations', 'reference')->whereNull('deleted_at')],
            'participant' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'event' => ['required', 'string', 'max:255'],
            'role' => ['sometimes', 'string', Rule::in(self::ROLES)],
            'block_no' => ['nullable', 'string', 'max:50'],
            'payment' => ['nullable', 'string', 'max:50'],
            'payment_status' => ['required', 'string', Rule::in(['Paid', 'Pending', 'N/A', 'Refunded'])],
            'attendance' => ['required', 'string', Rule::in(['Present', 'Absent', 'Not Yet Recorded', 'Excused', 'Late'])],
            'reg_date' => ['nullable', 'string', 'max:20'],
            'qr_code' => ['nullable', 'string', 'max:100'],
        ]);

        $validated['role'] ??= self::DEFAULT_ROLE;

        // Staff may register anybody, but the duplicate and capacity rules
        // still apply: the event behind the title is resolved and checked
        // with the registrant's own account when one exists, so a registrar
        // cannot double-book a student or overfill an event by hand.
        $event = Event::where('title', trim($validated['event']))->first();

        if ($request->user()?->role === 'Organizer'
            && (! $event || (int) $event->organizer_user_id !== (int) $request->user()->getKey())) {
            abort(404);
        }

        if ($event) {
            $account = UserAccount::whereRaw('LOWER(email) = ?', [mb_strtolower(trim($validated['email']))])->first();
            $flag = $eligibility->check($event, $account);

            if (in_array($flag['code'], ['duplicate', 'capacity', 'ineligible'], true)) {
                throw ValidationException::withMessages([
                    'event' => [$flag['reason']],
                ]);
            }
        }

        // A soft-deleted namesake still holds its unique reference, so revive it
        // rather than colliding with the index (see UserAccountController::persist).
        // Only trashed rows are considered: a live duplicate is already rejected
        // by the validation rule above.
        $revived = Registration::onlyTrashed()->where('reference', $validated['reference'])->first();

        if ($revived) {
            $revived->restore();
            $revived->fill($validated);
            $revived->forceFill(['event_id' => $this->resolveEventId($validated['event'] ?? null)]);
            $revived->save();

            return response()->json($revived->refresh(), 200);
        }

        // The event title is what the client submits; the event id is derived
        // from it here. event_id is deliberately kept out of $fillable so that
        // it can only ever be written from a resolved title here, rather than
        // accepted from the request body where it could be pointed at a
        // different event than the one the registration claims.
        $registration = new Registration;
        $registration->forceFill($validated);
        $registration->event_id = $this->resolveEventId($validated['event'] ?? null);
        $registration->save();

        return response()->json($registration, 201);
    }

    /**
     * Resolve an event title to its id, or null when no event matches.
     *
     * A registration naming an event that does not exist keeps a null
     * event_id rather than being rejected, which preserves the existing
     * behaviour for historical rows whose event was deleted.
     */
    private function resolveEventId(?string $title): ?int
    {
        if ($title === null || trim($title) === '') {
            return null;
        }

        return Event::where('title', trim($title))->value('id');
    }

    /**
     * Student accounts may only view their own pass history.
     */
    public function show(Request $request, Registration $registration)
    {
        if ($request->user()?->role === 'Student'
            && strcasecmp((string) $registration->email, (string) $request->user()->email) !== 0) {
            abort(404);
        }

        $this->authorizeOrganizerRegistration($request, $registration);

        return response()->json($registration);
    }

    /**
     * Self-service registration for a student account.
     */
    public function selfRegister(Request $request, EventEligibility $eligibility)
    {
        $validated = $request->validate([
            'event_reference' => ['required', 'string', 'max:255'],
            'participant' => ['sometimes', 'nullable', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'role' => ['sometimes', 'nullable', 'string', Rule::in(self::ROLES)],
            'qr_code' => ['sometimes', 'nullable', 'string', 'max:100'],
            'payment' => ['sometimes', 'nullable', 'string', 'max:50'],
            'payment_status' => ['sometimes', 'nullable', 'string', Rule::in(['Paid', 'Pending', 'N/A', 'Refunded'])],
        ]);

        $user = $request->user();

        if (! $user || $user->role !== 'Student') {
            return response()->json(['message' => 'Only student accounts may self-register.'], 403);
        }

        $event = Event::where('reference', trim($validated['event_reference']))->first();

        if (! $event) {
            throw ValidationException::withMessages([
                'event_reference' => ['The selected event could not be found.'],
            ]);
        }

        if ($event->status !== 'Approved') {
            throw ValidationException::withMessages([
                'event_reference' => ['This event is not open for self-registration.'],
            ]);
        }

        if ($event->event_date && $event->event_date->format('Y-m-d') < now()->toDateString()) {
            throw ValidationException::withMessages([
                'event_reference' => ['Registration is closed because the event date has passed.'],
            ]);
        }

        $flag = $eligibility->check($event, $user);

        if (in_array($flag['code'], ['duplicate', 'capacity', 'ineligible'], true)) {
            throw ValidationException::withMessages([
                'event_reference' => [$flag['reason']],
            ]);
        }

        $reference = Registration::withTrashed()
            ->where('reference', 'like', 'REG-%')
            ->pluck('reference')
            ->map(fn (string $reference) => (int) substr($reference, 4))
            ->filter(fn (int $number) => $number > 0)
            ->max() ?? 0;

        $registration = new Registration([
            'reference' => 'REG-'.str_pad((string) $reference + 1, 4, '0', STR_PAD_LEFT),
            'participant' => $user->name,
            'email' => $user->email,
            'role' => 'Student',
            'event' => $event->title,
            'payment' => 'Free',
            'payment_status' => 'N/A',
            'attendance' => 'Not Yet Recorded',
            'reg_date' => now()->format('Y-m-d'),
            'qr_code' => 'PASS-'.strtoupper(bin2hex(random_bytes(5))),
        ]);

        $registration->forceFill([
            'event_id' => $event->id,
            'user_account_id' => $user->id,
        ]);
        $registration->save();

        return response()->json($registration, 201);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Registration $registration)
    {
        $this->authorizeOrganizerRegistration($request, $registration);

        $validated = $request->validate([
            'reference' => ['sometimes', 'string', 'max:50', Rule::unique('registrations', 'reference')->ignore($registration->id)],
            'participant' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255'],
            'event' => ['sometimes', 'required', 'string', 'max:255'],
            'role' => ['sometimes', 'required', 'string', Rule::in(self::ROLES)],
            'block_no' => ['nullable', 'string', 'max:50'],
            'payment' => ['nullable', 'string', 'max:50'],
            'payment_status' => ['sometimes', 'required', 'string', Rule::in(['Paid', 'Pending', 'N/A', 'Refunded'])],
            'attendance' => ['sometimes', 'required', 'string', Rule::in(['Present', 'Absent', 'Not Yet Recorded', 'Excused', 'Late'])],
            'reg_date' => ['nullable', 'string', 'max:20'],
            'qr_code' => ['nullable', 'string', 'max:100'],
        ]);

        if ($request->user()?->role === 'Organizer' && array_key_exists('event', $validated)) {
            $newEvent = Event::where('title', trim($validated['event']))->first();
            abort_unless($newEvent && (int) $newEvent->organizer_user_id === (int) $request->user()->getKey(), 404);
        }

        $registration->update($validated);

        // Keep the derived event id in step when the event title changes.
        if (array_key_exists('event', $validated)) {
            $registration->forceFill([
                'event_id' => $this->resolveEventId($validated['event']),
            ])->save();
        }

        return response()->json($registration->refresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Request $request, Registration $registration)
    {
        $this->authorizeOrganizerRegistration($request, $registration);
        $registration->delete();

        return response()->noContent();
    }

    /** Cancel the signed-in student's own future event registration. */
    public function cancelStudent(Request $request, Registration $registration)
    {
        if ($request->user()?->role !== 'Student') {
            return response()->json(['message' => 'Only students can use this cancellation endpoint.'], 403);
        }

        if (strcasecmp((string) $registration->email, (string) $request->user()->email) !== 0) {
            abort(404);
        }

        $event = $registration->eventRelation;
        if ($registration->attendances()->exists()
            || ($event?->event_date && $event->event_date->isPast())
            || in_array($event?->status, ['Completed', 'Cancelled'], true)) {
            return response()->json([
                'message' => 'This registration can no longer be cancelled because attendance has started or the event has ended.',
            ], 409);
        }

        $registration->delete();

        return response()->json(['message' => 'Registration cancelled.']);
    }

    private function authorizeOrganizerRegistration(Request $request, Registration $registration): void
    {
        if ($request->user()?->role !== 'Organizer') {
            return;
        }

        abort_unless(
            (int) $registration->eventRelation?->organizer_user_id === (int) $request->user()->getKey(),
            404,
        );
    }

    /**
     * Return a downloadable .ics calendar invite for the registration's event.
     *
     * Authenticated via the normal bearer token (role:registrations). The client
     * fetches the bytes with the Authorization header and triggers a download via
     * a blob URL — the same pattern used for certificate downloads.
     */
    public function calendar(Request $request, Registration $registration)
    {
        if ($request->user()?->role === 'Student'
            && strcasecmp((string) $registration->email, (string) $request->user()->email) !== 0) {
            abort(404);
        }
        $this->authorizeOrganizerRegistration($request, $registration);

        $registration->loadMissing('eventRelation');

        $event = $registration->eventRelation;

        if (! $event) {
            return response()->json(['message' => 'Event not found for this registration.'], 404);
        }

        // Re-use the ICS builder from the reminder job so the format stays identical.
        $job     = new SendEventReminderJob($registration, $event);
        $ics     = $job->buildIcs();
        $safe    = preg_replace('/[^A-Za-z0-9_\-]/', '_', $event->title);

        return response($ics, 200, [
            'Content-Type'        => 'text/calendar; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"{$safe}.ics\"",
        ]);
    }

    /**
     * Queue a reminder email for each of the given registrations.
     *
     * The scheduled sweep (events:send-reminders, 08:00 daily) covers every
     * registration for tomorrow's events; this is the manual path, used when
     * somebody is told about a change after the morning run.
     *
     * Reuses SendEventReminderJob rather than a job of its own, so a manual
     * reminder and an automatic one are byte-identical from the participant's
     * point of view - same template, same .ics attachment, same retry policy.
     * Jobs go to the default queue and need `php artisan queue:work` running.
     *
     * Rows are dispatched one at a time and failures are collected, so a single
     * unresolvable event cannot cost the whole batch. A registration is skipped
     * when its event cannot be resolved or its address is unusable, and both are
     * reported back so the operator can see who was missed.
     */
    public function sendReminders(Request $request)
    {
        $validated = $request->validate([
            'references' => ['required', 'array', 'min:1', 'max:500'],
            'references.*' => ['required', 'string', 'max:50'],
        ]);

        // Keyed by reference so a duplicated entry in the request cannot dispatch
        // the same reminder twice.
        $wanted = array_values(array_unique($validated['references']));

        $registrationsQuery = Registration::with('eventRelation')->whereIn('reference', $wanted);
        if ($request->user()?->role === 'Organizer') {
            $registrationsQuery->whereHas('eventRelation', fn ($event) => $event->where('organizer_user_id', $request->user()->getKey()));
        }
        $registrations = $registrationsQuery->get()->keyBy('reference');

        $queued = 0;
        $skipped = [];

        foreach ($wanted as $reference) {
            $registration = $registrations->get($reference);

            if (! $registration) {
                $skipped[] = ['reference' => $reference, 'reason' => 'Registration not found.'];

                continue;
            }

            $event = $registration->eventRelation;

            if (! $event) {
                $skipped[] = ['reference' => $reference, 'reason' => 'No event attached to this registration.'];

                continue;
            }

            // The same guard the job applies itself, applied here as well so the
            // operator is told immediately rather than after the queue drains.
            if (blank($registration->email) || ! filter_var($registration->email, FILTER_VALIDATE_EMAIL)) {
                $skipped[] = ['reference' => $reference, 'reason' => 'No valid email address on file.'];

                continue;
            }

            SendEventReminderJob::dispatch($registration, $event);
            $queued++;
        }

        return response()->json([
            'queued' => $queued,
            'skipped' => $skipped,
        ]);
    }
}
