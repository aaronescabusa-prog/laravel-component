<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SendEventReminderJob;
use App\Models\Event;
use App\Models\Registration;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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
    public function store(Request $request)
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
     * Display the specified resource.
     */
    public function show(Registration $registration)
    {
        return response()->json($registration);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Registration $registration)
    {
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
    public function destroy(Registration $registration)
    {
        $registration->delete();

        return response()->noContent();
    }

    /**
     * Return a downloadable .ics calendar invite for the registration's event.
     *
     * Authenticated via the normal bearer token (role:registrations). The client
     * fetches the bytes with the Authorization header and triggers a download via
     * a blob URL — the same pattern used for certificate downloads.
     */
    public function calendar(Registration $registration)
    {
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

        $registrations = Registration::with('eventRelation')
            ->whereIn('reference', $wanted)
            ->get()
            ->keyBy('reference');

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
