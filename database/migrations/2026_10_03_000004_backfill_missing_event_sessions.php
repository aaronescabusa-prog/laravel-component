<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Give every dated event its morning and afternoon check-in windows.
     *
     * The table migration only seeded sessions for events that already had
     * registrations, so events nobody had signed up for were left with no
     * window to check anybody into. This closes that gap for the rows already
     * in the database without rewriting the original migration.
     */
    public function up(): void
    {
        if (! Schema::hasTable('attendance_sessions')) {
            return;
        }

        DB::table('events')
            ->whereNotNull('event_date')
            ->whereNull('deleted_at')
            ->whereNotExists(function ($query) {
                $query->selectRaw('1')
                    ->from('attendance_sessions')
                    ->whereColumn('attendance_sessions.event_id', 'events.id');
            })
            ->orderBy('id')
            ->chunkById(200, function ($events) {
                $rows = [];

                $now = now();

                foreach ($events as $event) {
                    foreach ($this->windows() as $window) {
                        $rows[] = [
                            'event_id' => $event->id,
                            'label' => $window['label'],
                            'session_date' => $event->event_date,
                            'time_in' => $window['time_in'],
                            'time_out' => $window['time_out'],
                            'grace_minutes' => 15,
                            'status' => 'open',
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    }
                }

                if ($rows !== []) {
                    DB::table('attendance_sessions')->insert($rows);
                }
            });

        $this->backfillTokens();
    }

    /**
     * Reverse the migration.
     *
     * Only the windows created by this migration are removed: an event that
     * still has none of the seeded labels was never touched here, so deleting
     * by label cannot destroy a session a registrar configured by hand.
     */
    public function down(): void
    {
        if (! Schema::hasTable('attendance_sessions')) {
            return;
        }

        DB::table('attendance_sessions')
            ->whereIn('label', array_column($this->windows(), 'label'))
            ->delete();
    }

    /**
     * Default windows for a school day, matching App\Services\EventSchedule.
     *
     * @return array<int, array{label: string, time_in: string, time_out: string}>
     */
    private function windows(): array
    {
        return [
            ['label' => 'Morning', 'time_in' => '08:00:00', 'time_out' => '12:00:00'],
            ['label' => 'Afternoon', 'time_in' => '13:00:00', 'time_out' => '17:00:00'],
        ];
    }

    /**
     * Ensure every event can be printed as a poster.
     */
    private function backfillTokens(): void
    {
        if (! Schema::hasColumn('events', 'checkin_token')) {
            return;
        }

        DB::table('events')
            ->whereNull('checkin_token')
            ->orderBy('id')
            ->chunkById(200, function ($events) {
                foreach ($events as $event) {
                    DB::table('events')
                        ->where('id', $event->id)
                        ->update(['checkin_token' => bin2hex(random_bytes(16))]);
                }
            });
    }
};
