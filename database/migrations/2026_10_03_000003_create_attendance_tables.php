<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Attendance becomes a child of the event, with a time-in/time-out per session.
 *
 * Previously attendance was a single column on the registration, which could
 * express neither a morning and an afternoon session, nor when someone
 * actually arrived, nor who recorded it. This replaces that with two tables:
 *
 *   attendance_sessions  the scheduled window for one part of one event
 *                        (Morning / Afternoon) for one date
 *   attendances          one participant's punches within one session
 *
 * The legacy `registrations.attendance` column is intentionally left in place.
 * It is still read by the dashboard, the attendance report, the CSV export and
 * the certificate screens, and is kept in sync as a roll-up by
 * AttendanceRecorder rather than rewritten everywhere.
 */
return new class extends Migration
{
    /** Default windows for a school day, in local time (Asia/Manila). */
    private const MORNING = ['label' => 'Morning', 'time_in' => '08:00:00', 'time_out' => '12:00:00'];

    private const AFTERNOON = ['label' => 'Afternoon', 'time_in' => '13:00:00', 'time_out' => '17:00:00'];

    /** Legacy values that mean "this person attended". */
    private const ATTENDED = ['Present', 'Late', 'Excused'];

    public function up(): void
    {
        Schema::create('attendance_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained('events')->cascadeOnDelete();
            $table->string('label');
            $table->date('session_date');
            $table->time('time_in')->nullable();
            $table->time('time_out')->nullable();
            $table->unsignedSmallInteger('grace_minutes')->default(15);
            $table->string('status')->default('open');
            $table->string('created_by')->nullable();
            $table->timestamps();

            // One "Morning" and one "Afternoon" per event per day.
            $table->unique(['event_id', 'session_date', 'label'], 'attendance_sessions_event_date_label_unique');
        });

        Schema::create('attendances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('attendance_session_id')->constrained('attendance_sessions')->cascadeOnDelete();
            $table->foreignId('registration_id')->constrained('registrations')->cascadeOnDelete();
            $table->timestamp('time_in')->nullable();
            $table->timestamp('time_out')->nullable();
            $table->string('status')->default('Not Yet Recorded');
            $table->timestamp('recorded_at')->nullable();
            $table->string('recorded_by')->nullable();
            $table->timestamps();

            // A participant is recorded at most once per session.
            $table->unique(['attendance_session_id', 'registration_id'], 'attendances_session_registration_unique');
            $table->index('registration_id');
        });

        $this->seedSessions();
        $this->backfillAttendances();
    }

    public function down(): void
    {
        Schema::dropIfExists('attendances');
        Schema::dropIfExists('attendance_sessions');
    }

    /**
     * Give every existing event its morning and afternoon windows.
     *
     * Events with no registrations are skipped: there is nobody to check in, and
     * an empty roster is not evidence that the event was scheduled that way.
     */
    private function seedSessions(): void
    {
        $eventIds = DB::table('registrations')
            ->whereNotNull('event_id')
            ->distinct()
            ->pluck('event_id');

        $rows = [];

        foreach ($eventIds as $eventId) {
            $date = DB::table('events')->where('id', $eventId)->value('event_date')
                ?? now()->format('Y-m-d');

            foreach ([self::MORNING, self::AFTERNOON] as $window) {
                $rows[] = [
                    'event_id'       => $eventId,
                    'label'          => $window['label'],
                    'session_date'   => $date,
                    'time_in'        => $window['time_in'],
                    'time_out'       => $window['time_out'],
                    'grace_minutes'  => 15,
                    'status'         => 'open',
                    'created_at'     => now(),
                    'updated_at'     => now(),
                ];
            }
        }

        foreach (array_chunk($rows, 100) as $chunk) {
            DB::table('attendance_sessions')->insert($chunk);
        }
    }

    /**
     * Carry the old single-value attendance onto both sessions.
     *
     * This is the subtle part. Strict certificate eligibility requires a
     * time-in AND a time-out on every session, so naively copying "Present"
     * across as a null/null pair would make everyone who already holds a
     * certificate suddenly ineligible and silently void it. Instead an
     * attended registration is backfilled with both punches set to the
     * session's own window: the recorded state is preserved, and the
     * timestamps are clearly derived from the schedule rather than measured.
     */
    private function backfillAttendances(): void
    {
        $rows = [];

        $registrations = DB::table('registrations')->whereNotNull('event_id')->orderBy('id')->cursor();

        foreach ($registrations as $registration) {
            $attended = in_array($registration->attendance, self::ATTENDED, true);

            $sessions = DB::table('attendance_sessions')
                ->where('event_id', $registration->event_id)
                ->orderBy('id')
                ->get();

            foreach ($sessions as $session) {
                $rows[] = [
                    'attendance_session_id' => $session->id,
                    'registration_id'       => $registration->id,
                    'time_in'               => $attended ? $session->session_date.' '.$session->time_in : null,
                    'time_out'              => $attended ? $session->session_date.' '.$session->time_out : null,
                    'status'                => $registration->attendance,
                    'recorded_at'           => $attended ? now() : null,
                    'recorded_by'           => $attended ? 'migration' : null,
                    'created_at'            => now(),
                    'updated_at'            => now(),
                ];
            }
        }

        foreach (array_chunk($rows, 100) as $chunk) {
            DB::table('attendances')->insert($chunk);
        }
    }
};