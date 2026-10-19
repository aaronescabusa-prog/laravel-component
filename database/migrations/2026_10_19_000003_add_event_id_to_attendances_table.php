<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->foreignId('event_id')
                ->nullable()
                ->after('attendance_session_id')
                ->constrained('events')
                ->nullOnDelete();
        });

        DB::table('attendances')
            ->join('attendance_sessions', 'attendance_sessions.id', '=', 'attendances.attendance_session_id')
            ->select('attendances.id as attendance_id', 'attendance_sessions.event_id')
            ->orderBy('attendances.id')
            ->chunkById(500, function ($rows) {
                foreach ($rows as $row) {
                    DB::table('attendances')
                        ->where('id', $row->attendance_id)
                        ->update(['event_id' => $row->event_id]);
                }
            }, 'attendances.id', 'attendance_id');
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropConstrainedForeignId('event_id');
        });
    }
};
