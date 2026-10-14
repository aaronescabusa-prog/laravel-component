<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\AttendanceSession;
use App\Models\Registration;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Records time-in / time-out punches against an event's sessions.
 *
 * Two responsibilities live here on purpose. First, the punches themselves,
 * with the rules that make them trustworthy: a check-out cannot exist without a
 * check-in, a check-out cannot precede it, and a closed session accepts
 * nothing. Second, the legacy `registrations.attendance` column is kept in sync
 * as a roll-up, because the dashboard, the attendance report, the CSV export
 * and the certificate screens still read it. Keeping it derived here means
 * those screens do not each have to learn about sessions.
 */
class AttendanceRecorder
{
    /**
     * Record an arrival.
     *
     * Re-punching someone who is already in is refused rather than silently
     * overwriting their arrival: at a doorway the second tap is nearly always
     * a mis-tap, and quietly moving someone's check-in time would corrupt the
     * record.
     */
    public function punchIn(
        AttendanceSession $session,
        Registration $registration,
        ?CarbonImmutable $at = null,
        ?string $actor = null,
        ?int $actorUserId = null,
    ): Attendance {
        $this->guardSession($session);
        $at ??= CarbonImmutable::now();

        $attendance = $this->rowFor($session, $registration);

        if ($attendance->time_in !== null) {
            throw ValidationException::withMessages([
                'attendance' => 'This participant was already checked in at '.$attendance->time_in->format('g:i A').'.',
            ]);
        }

        $attendance->fill([
            'time_in' => $at,
            // Excused is a deliberate human override and must survive a punch,
            // otherwise checking an excused student in would silently drop the
            // reason they were excused.
            'status' => $attendance->status === Attendance::EXCUSED
                ? Attendance::EXCUSED
                : ($this->isLate($session, $at) ? Attendance::LATE : Attendance::PRESENT),
            'recorded_at' => $at,
            'recorded_by' => $actor,
            'recorded_by_user_id' => $actorUserId,
        ])->save();

        $this->syncRollup($registration);

        return $attendance->refresh();
    }

    /**
     * Record a departure.
     */
    public function punchOut(
        AttendanceSession $session,
        Registration $registration,
        ?CarbonImmutable $at = null,
        ?string $actor = null,
        ?int $actorUserId = null,
    ): Attendance {
        $this->guardSession($session);
        $at ??= CarbonImmutable::now();

        $attendance = $this->rowFor($session, $registration);

        if ($attendance->time_in === null) {
            throw ValidationException::withMessages([
                'attendance' => 'Cannot check out someone who has not been checked in.',
            ]);
        }

        if ($attendance->time_out !== null) {
            throw ValidationException::withMessages([
                'attendance' => 'This participant was already checked out at '.$attendance->time_out->format('g:i A').'.',
            ]);
        }

        if ($at < $attendance->time_in) {
            throw ValidationException::withMessages([
                'attendance' => 'Check-out cannot be earlier than the check-in.',
            ]);
        }

        $attendance->fill([
            'time_out' => $at,
            'status' => $attendance->status === Attendance::EXCUSED
                ? Attendance::EXCUSED
                : ($attendance->status === Attendance::LATE ? Attendance::LATE : Attendance::PRESENT),
            'recorded_at' => $at,
            'recorded_by' => $actor,
            'recorded_by_user_id' => $actorUserId,
        ])->save();

        $this->syncRollup($registration);

        return $attendance->refresh();
    }

    /**
     * Punch a whole roster at once, which is what the check-in screen does.
     *
     * Runs in a transaction and reports per-participant failures rather than
     * aborting the batch: one participant who is already checked in should not
     * cost the other forty their arrival time.
     *
     * @param  iterable<int, Registration>  $registrations
     * @return array{punched: Collection<int, Attendance>, skipped: array<int, string>}
     */
    public function punchMany(
        AttendanceSession $session,
        iterable $registrations,
        string $direction,
        ?CarbonImmutable $at = null,
        ?string $actor = null,
        ?int $actorUserId = null,
    ): array {
        $this->guardSession($session);
        $at ??= CarbonImmutable::now();

        $punched = new Collection;
        $skipped = [];

        DB::transaction(function () use ($session, $registrations, $direction, $at, $actor, $actorUserId, $punched, &$skipped) {
            foreach ($registrations as $registration) {
                try {
                    $punched->push($direction === 'out'
                        ? $this->punchOut($session, $registration, $at, $actor, $actorUserId)
                        : $this->punchIn($session, $registration, $at, $actor, $actorUserId));
                } catch (ValidationException $e) {
                    $skipped[$registration->reference] = collect($e->errors())->flatten()->first();
                }
            }
        });

        return ['punched' => $punched, 'skipped' => $skipped];
    }

    /**
     * Mark a session explicitly, without a punch: Absent or Excused.
     *
     * Excused deliberately leaves both punches null. Under the strict
     * certificate rule an excused student therefore does not qualify, which is
     * the honest consequence of "in and out on every session" and is called out
     * rather than papered over.
     */
    public function mark(
        AttendanceSession $session,
        Registration $registration,
        string $status,
        ?string $actor = null,
        ?int $actorUserId = null,
    ): Attendance {
        $this->guardSession($session);

        if (! in_array($status, [Attendance::ABSENT, Attendance::EXCUSED], true)) {
            throw ValidationException::withMessages([
                'status' => 'Only Absent or Excused can be set without a punch.',
            ]);
        }

        $attendance = $this->rowFor($session, $registration);

        $attendance->fill([
            'status' => $status,
            'time_in' => null,
            'time_out' => null,
            'recorded_at' => CarbonImmutable::now(),
            'recorded_by' => $actor,
            'recorded_by_user_id' => $actorUserId,
        ])->save();

        $this->syncRollup($registration);

        return $attendance->refresh();
    }

    /**
     * Refresh the legacy roll-up column from this registration's sessions.
     *
     * The mapping is deliberately conservative and matches the vocabulary the
     * existing screens already understand:
     *
     *   every session punched in and out -> Present, or Late if any was late
     *   any session excused             -> Excused
     *   partially recorded              -> Absent
     *   nothing recorded                -> Not Yet Recorded
     */
    public function syncRollup(Registration $registration): void
    {
        $attendance = $registration->attendances()->with('session')->get();

        if ($attendance->isEmpty()) {
            $status = Attendance::NOT_RECORDED;
        } elseif ($attendance->contains(fn (Attendance $a) => $a->status === Attendance::EXCUSED)) {
            $status = Attendance::EXCUSED;
        } elseif ($attendance->contains(fn (Attendance $a) => $a->status === Attendance::ABSENT)) {
            // Recorded as having missed a session outright.
            $status = Attendance::ABSENT;
        } elseif ($this->coversEverySession($registration) && $attendance->every(fn (Attendance $a) => $a->isComplete())) {
            $status = $attendance->contains(fn (Attendance $a) => $a->status === Attendance::LATE)
                ? Attendance::LATE
                : Attendance::PRESENT;
        } else {
            // Checked in for part of the day but not yet closed out. Reporting
            // these as absent would contradict the punch just taken at the door,
            // and `every` above only proves the sessions that have rows.
            $status = Attendance::PRESENT;
        }

        if ($registration->attendance !== $status) {
            $registration->forceFill(['attendance' => $status])->save();
        }
    }

    /**
     * Whether this registration has a row for every session its event scheduled.
     *
     * Needed because a session nobody was ever recorded against leaves no row,
     * so counting existing rows cannot tell "finished the morning" apart from
     * "finished the whole day".
     */
    private function coversEverySession(Registration $registration): bool
    {
        if ($registration->event_id === null) {
            return false;
        }

        $expected = AttendanceSession::where('event_id', $registration->event_id)->count();

        return $expected > 0 && $expected === $registration->attendances()->count();
    }

    /**
     * Find or create the attendance row for this pair.
     */
    private function rowFor(AttendanceSession $session, Registration $registration): Attendance
    {
        return Attendance::firstOrCreate([
            'attendance_session_id' => $session->id,
            'registration_id' => $registration->id,
        ]);
    }

    private function guardSession(AttendanceSession $session): void
    {
        if (! $session->isOpen()) {
            throw ValidationException::withMessages([
                'session' => 'The '.$session->label.' session is closed and no longer accepts punches.',
            ]);
        }
    }

    private function isLate(AttendanceSession $session, CarbonImmutable $at): bool
    {
        $threshold = $session->lateAfter();

        return $threshold !== null && $at > $threshold;
    }
}
