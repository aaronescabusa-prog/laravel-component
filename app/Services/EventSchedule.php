<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\AttendanceSession;
use App\Models\Event;
use App\Models\ObligationAttendance;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Creates and maintains an event's morning / afternoon check-in windows.
 *
 * Sessions are rows rather than four columns on the event so that an event
 * with one session, or three, still works without a schema change.
 */
class EventSchedule
{
    /**
     * Default windows for a school day, local time (Asia/Manila).
     */
    public const MORNING = ['label' => 'Morning', 'time_in' => '08:00:00', 'time_out' => '12:00:00'];

    public const AFTERNOON = ['label' => 'Afternoon', 'time_in' => '13:00:00', 'time_out' => '17:00:00'];

    public const DEFAULT_WINDOWS = [self::MORNING, self::AFTERNOON];

    /** Longest window a session may span, as a sanity bound. */
    private const MAX_WINDOW_HOURS = 16;

    /**
     * Accepts HH:MM or HH:MM:SS.
     *
     * A regex rather than two date_format rules: Laravel requires every rule on
     * an attribute to pass, so listing both formats would demand the input be
     * HH:MM *and* HH:MM:SS simultaneously and reject both.
     */
    public const TIME_PATTERN = '/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/';

    /**
     * Give an event its morning and afternoon sessions if it has none.
     *
     * Idempotent and safe to call on every save: existing sessions are left
     * alone, because a registrar who has already adjusted the windows must not
     * have them reset by an unrelated edit to the event's description.
     */
    public function ensureSessions(Event $event): void
    {
        if ($event->attendanceSessions()->exists()) {
            return;
        }

        $date = $event->event_date?->format('Y-m-d') ?? now()->format('Y-m-d');

        foreach (self::DEFAULT_WINDOWS as $window) {
            AttendanceSession::firstOrCreate(
                [
                    'event_id' => $event->id,
                    'session_date' => $date,
                    'label' => $window['label'],
                ],
                [
                    'time_in' => $window['time_in'],
                    'time_out' => $window['time_out'],
                    'grace_minutes' => 15,
                    'status' => 'open',
                ]
            );
        }
    }

    /**
     * Change a session's scheduled window.
     *
     * Refuses to leave an existing punch outside the new window: narrowing the
     * afternoon to 14:00-16:00 while someone was punched in at 13:05 would
     * leave a record that can never be satisfied again.
     */
    public function updateWindow(AttendanceSession $session, ?string $timeIn, ?string $timeOut): AttendanceSession
    {
        $this->guardFormat($timeIn);
        $this->guardFormat($timeOut);

        if ($timeIn && $timeOut && strtotime($timeOut) <= strtotime($timeIn)) {
            throw ValidationException::withMessages([
                'time_out' => 'The session must end after it starts.',
            ]);
        }

        if ($timeIn && $timeOut) {
            $hours = (strtotime($timeOut) - strtotime($timeIn)) / 3600;

            if ($hours > self::MAX_WINDOW_HOURS) {
                throw ValidationException::withMessages([
                    'time_out' => 'A session cannot run for more than '.self::MAX_WINDOW_HOURS.' hours.',
                ]);
            }
        }

        // Check the new window against punches that already exist *before*
        // persisting it. Saving first and validating afterwards would leave a
        // rejected window on the session, stranding records that can no longer
        // be satisfied.
        $timeIn = $this->normaliseTime($timeIn);
        $timeOut = $this->normaliseTime($timeOut);

        $this->guardExistingPunches(
            (clone $session)->forceFill(['time_in' => $timeIn, 'time_out' => $timeOut])
        );

        $session->fill([
            'time_in' => $timeIn,
            'time_out' => $timeOut,
        ])->save();

        return $session->refresh();
    }

    /**
     * Open or close a session, optionally stamping the closing punches.
     *
     * Closing is what stops a late scan at the door from rewriting a session
     * that has already been signed off. Everyone still checked in is stamped
     * as having left, so a closed session can never be left half-recorded.
     */
    public function close(AttendanceSession $session, ?string $actor = null, ?int $actorUserId = null): AttendanceSession
    {
        if (! $session->isOpen()) {
            return $session;
        }

        $now = now();

        DB::transaction(function () use ($session, $now, $actor, $actorUserId) {
            Attendance::where('attendance_session_id', $session->id)
                ->whereNotNull('time_in')
                ->whereNull('time_out')
                ->get()
                ->each(function (Attendance $attendance) use ($now, $actor) {
                    $attendance->forceFill([
                        'time_out' => $now,
                        // Someone who already arrived late stays late. Stamping
                        // the closing time says nothing about when they turned
                        // up, so the earlier observation is kept.
                        'status' => $attendance->status === Attendance::LATE
                            ? Attendance::LATE
                            : Attendance::PRESENT,
                        'recorded_at' => $now,
                        'recorded_by' => $actor,
                    ])->save();
                });

            ObligationAttendance::where('attendance_session_id', $session->id)
                ->whereNotNull('time_in')
                ->whereNull('time_out')
                ->get()
                ->each(function (ObligationAttendance $attendance) use ($now, $actorUserId) {
                    $attendance->forceFill([
                        'time_out' => $now,
                        'status' => $attendance->status === Attendance::LATE ? Attendance::LATE : Attendance::PRESENT,
                        'recorded_at' => $now,
                        'recorded_by_user_id' => $actorUserId,
                    ])->save();
                });

            $session->fill(['status' => 'closed'])->save();
        });

        return $session->refresh();
    }

    public function reopen(AttendanceSession $session): AttendanceSession
    {
        $session->fill(['status' => 'open'])->save();

        return $session->refresh();
    }

    /**
     * Validate an HH:MM or HH:MM:SS string, allowing null.
     */
    private function guardFormat(?string $time): void
    {
        if ($time === null || $time === '') {
            return;
        }

        $validator = validator(
            ['time' => $time],
            ['time' => ['nullable', 'regex:'.self::TIME_PATTERN]]
        );

        if ($validator->fails()) {
            throw ValidationException::withMessages([
                'time_in' => 'Times must be in 24-hour HH:MM format.',
            ]);
        }
    }

    /**
     * Normalise a validated window to HH:MM:SS.
     *
     * Both HH:MM and HH:MM:SS are accepted on input; storing one shape means
     * the value a registrar typed and the value the check-in screen shows back
     * to them do not differ for no reason.
     */
    private function normaliseTime(?string $time): ?string
    {
        if ($time === null || $time === '') {
            return null;
        }

        return strlen($time) === 5 ? $time.':00' : $time;
    }

    /**
     * Refuse a window that would strand punches already taken.
     */
    private function guardExistingPunches(AttendanceSession $session): void
    {
        if (! $session->time_in || ! $session->time_out) {
            return;
        }

        $windowStart = $session->session_date->format('Y-m-d').' '.$session->time_in;
        $windowEnd = $session->session_date->format('Y-m-d').' '.$session->time_out;

        $outside = Attendance::where('attendance_session_id', $session->id)
            ->where(function ($query) use ($windowStart, $windowEnd) {
                $query->where(function ($q) use ($windowStart) {
                    $q->whereNotNull('time_in')->where('time_in', '<', $windowStart);
                })->orWhere(function ($q) use ($windowEnd) {
                    $q->whereNotNull('time_out')->where('time_out', '>', $windowEnd);
                });
            })
            ->count();

        if ($outside > 0) {
            throw ValidationException::withMessages([
                'time_in' => $outside.' participant(s) were already recorded outside that window. '
                    .'Widen the window or clear those punches first.',
            ]);
        }
    }

    /**
     * Validation rules for the session endpoints.
     *
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'label' => ['required', 'string', 'max:60', Rule::unique('attendance_sessions', 'label')
                ->where('event_id', '=', ':event_id')],
            'session_date' => ['required', 'date'],
            'time_in' => ['nullable', 'regex:'.self::TIME_PATTERN],
            'time_out' => ['nullable', 'regex:'.self::TIME_PATTERN],
            'grace_minutes' => ['nullable', 'integer', 'min:0', 'max:240'],
        ];
    }
}
