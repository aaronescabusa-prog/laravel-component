<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\Certificate;
use App\Models\Event;
use App\Models\Registration;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Decides which students may receive a certificate for an event.
 *
 * The rule is strict: a participant qualifies only when *every* session of the
 * event carries both a time-in and a time-out. A half-recorded session is not
 * attendance, and an event with no sessions cannot vouch for anyone.
 *
 * Consequences worth stating plainly rather than hiding:
 *
 *   - An excused student does not qualify. Excused deliberately leaves both
 *     punches null, and the strict rule requires both. If a policy decision is
 *     ever made to let excused students through, this is the place to change it.
 *   - A registration whose event was renamed before the event_id backfill, and
 *     which therefore has no sessions at all, does not qualify.
 *
 * Events flagged `has_certificate = false` never produce certificates at all.
 */
class CertificateEligibility
{
    /**
     * Students who may be issued a certificate for an event.
     *
     * @return Collection<int, array{registration_id:int, reference:string, participant:string, email:string, event:string, attendance:string, eligible:bool, reason:string, sessions_complete:int, sessions_total:int}>
     */
    public function forEvent(Event $event): Collection
    {
        return $this->evaluate($event, $event->registrations()->orderByDesc('id')->get());
    }

    /**
     * Only the students who pass the rule.
     */
    public function eligibleForEvent(Event $event): Collection
    {
        return $this->forEvent($event)
            ->filter(fn (array $row) => $row['eligible'])
            ->values();
    }

    /**
     * Evaluate an arbitrary set of registrations against the rule.
     *
     * @param  Collection<int, Registration>  $registrations
     * @return Collection<int, array<string, mixed>>
     */
    public function evaluate(Event $event, Collection $registrations): Collection
    {
        if ($registrations->isEmpty()) {
            return $registrations;
        }

        // One query for every registration's sessions, rather than a query per
        // registration, which a roster of several hundred would otherwise turn
        // into several hundred round trips.
        $sessionsByRegistration = DB::table('attendances')
            ->join('attendance_sessions', 'attendance_sessions.id', '=', 'attendances.attendance_session_id')
            ->where('attendance_sessions.event_id', $event->id)
            ->whereIn('attendances.registration_id', $registrations->pluck('id'))
            ->get([
                'attendances.registration_id',
                'attendances.status',
                'attendances.time_in',
                'attendances.time_out',
            ])
            ->groupBy('registration_id');

        if (! $event->has_certificate) {
            return $registrations->map(fn (Registration $registration) => $this->row(
                $registration,
                $event,
                eligible: false,
                reason: 'This event does not issue certificates.',
            ));
        }

        // The rule is "in and out on every session", so the denominator has to
        // be every session the event has — not merely the rows that happen to
        // exist for this registration. Counting existing rows would let a
        // student who was punched for the morning alone look fully attended
        // simply because the afternoon left no row behind.
        $expectedSessions = $event->attendanceSessions()->count();

        return $registrations->map(function (Registration $registration) use ($sessionsByRegistration, $expectedSessions, $event) {
            $sessions = $sessionsByRegistration->get($registration->id, collect());
            $total = $expectedSessions;
            $complete = $sessions->filter(
                fn ($row) => $row->time_in !== null && $row->time_out !== null
            )->count();

            [$eligible, $reason] = $this->judge($registration, $sessions, $total, $complete);

            return $this->row($registration, $event, $eligible, $reason, $complete, $total);
        });
    }

    /**
     * Apply the strict rule and explain the outcome.
     *
     * @param  Collection<int, object>  $sessions
     * @return array{0: bool, 1: string}
     */
    private function judge(Registration $registration, Collection $sessions, int $total, int $complete): array
    {
        if ($total === 0) {
            return [false, 'No check-in sessions are recorded for this event.'];
        }

        $statuses = $sessions->pluck('status')->unique();

        if ($statuses->contains(Attendance::EXCUSED)) {
            return [false, 'Excused from a session, so attendance is incomplete.'];
        }

        if ($complete < $total) {
            // When every session failed the same way, name that reason rather
            // than the generic "missing a punch", which tells an administrator
            // nothing about what to fix.
            if ($statuses->count() === 1) {
                return [false, match ($statuses->first()) {
                    Attendance::ABSENT => 'Marked absent on the day of the event.',
                    Attendance::NOT_RECORDED => 'Attendance has not been recorded yet.',
                    default => 'Attendance is incomplete.',
                }];
            }

            $missing = $total - $complete;

            return [false, $missing === 1
                ? 'One session is missing a time-in or time-out.'
                : $missing.' sessions are missing a time-in or time-out.'];
        }

        return [true, 'Present for every session, in and out.'];
    }

    /**
     * @return array<string, mixed>
     */
    private function row(
        Registration $registration,
        Event $event,
        bool $eligible,
        string $reason,
        int $complete = 0,
        int $total = 0,
    ): array {
        return [
            'registration_id' => $registration->id,
            'reference' => $registration->reference,
            'participant' => $registration->participant,
            'email' => $registration->email,
            'event' => $event->title,
            'attendance' => $registration->attendance,
            'eligible' => $eligible,
            'reason' => $reason,
            'sessions_complete' => $complete,
            'sessions_total' => $total,
        ];
    }

    /**
     * Create or refresh the certificate rows for the eligible students of an
     * event, so the Certificates screen lists them before anything is sent.
     *
     * withTrashed() on the lookup is what makes re-issuing possible at all: a
     * soft-deleted certificate still holds its unique reference, so an ordinary
     * updateOrCreate would never find it and would instead fail on the unique
     * index. Restoring the row keeps its id and delivery history.
     *
     * @return Collection<int, Certificate>
     */
    public function issueForEvent(Event $event): Collection
    {
        $today = now()->format('Y-m-d');

        return $this->eligibleForEvent($event)->map(function (array $row) use ($event, $today) {
            $reference = 'CERT-'.$row['reference'];

            $existing = Certificate::withTrashed()->where('reference', $reference)->first();

            // event_id is server-derived, so it is deliberately absent from
            // Certificate::$fillable. Writing it through create()/update()
            // would silently discard it and leave the row unreachable from its
            // event, so force it past mass-assignment protection here.
            if ($existing) {
                if ($existing->trashed()) {
                    $existing->restore();
                }

                $existing->forceFill([
                    'participant' => $row['participant'],
                    'email' => $row['email'],
                    'event' => $event->title,
                    'event_id' => $event->id,
                    'status' => 'Pending',
                    'date_issued' => $today,
                    'qr_code' => 'QR-'.$row['reference'],
                ])->save();

                return $existing->refresh();
            }

            $certificate = new Certificate;

            $certificate->forceFill([
                'reference' => $reference,
                'participant' => $row['participant'],
                'email' => $row['email'],
                'event' => $event->title,
                'event_id' => $event->id,
                'status' => 'Pending',
                'date_issued' => $today,
                'qr_code' => 'QR-'.$row['reference'],
            ])->save();

            return $certificate;
        });
    }
}