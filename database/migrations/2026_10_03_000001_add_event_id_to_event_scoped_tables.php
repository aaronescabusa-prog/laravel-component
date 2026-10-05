<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Replaces the "event title as a foreign key" convention with a real
 * relationship.
 *
 * Registrations, certificates and certificate templates all identified their
 * event by storing the event's *title* in a varchar column. Renaming an event
 * therefore orphaned its roster, its template and its certificates with no
 * error anywhere, because nothing at the database level tied those rows to an
 * event. The title column is deliberately left in place: it is still what the
 * existing screens read and export, and dropping it is a separate cleanup.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['registrations', 'certificates', 'certificate_templates'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->foreignId('event_id')
                    ->nullable()
                    ->after('event')
                    ->constrained('events')
                    ->nullOnDelete();
            });
        }

        // Index for the join direction the app actually uses (roster by event).
        Schema::table('registrations', function (Blueprint $blueprint) {
            $blueprint->index(['event_id', 'attendance'], 'registrations_event_attendance_index');
        });

        $this->backfill('registrations');
        $this->backfill('certificates');
        $this->backfill('certificate_templates');
    }

    public function down(): void
    {
        Schema::table('registrations', function (Blueprint $blueprint) {
            $blueprint->dropIndex('registrations_event_attendance_index');
        });

        foreach (['registrations', 'certificates', 'certificate_templates'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropForeign(['event_id']);
                $blueprint->dropColumn('event_id');
            });
        }
    }

    /**
     * Point rows at the event whose title they stored.
     *
     * Done in PHP rather than a JOIN ... UPDATE so the mapping is explicit and
     * the query works identically on MySQL and MariaDB. Rows whose title no
     * longer matches an event keep a null event_id: they are orphans, and
     * silently attaching them to a same-named event would be worse than
     * leaving them for a human to resolve.
     */
    private function backfill(string $table): void
    {
        $titles = DB::table('events')
            ->whereNotNull('title')
            ->pluck('id', 'title');

        if ($titles->isEmpty()) {
            return;
        }

        DB::table($table)
            ->whereNull('event_id')
            ->whereNotNull('event')
            ->orderBy('id')
            ->chunkById(200, function ($rows) use ($titles, $table) {
                foreach ($rows as $row) {
                    $eventId = $titles->get($row->event);

                    if ($eventId !== null) {
                        DB::table($table)->where('id', $row->id)->update(['event_id' => $eventId]);
                    }
                }
            });
    }
};