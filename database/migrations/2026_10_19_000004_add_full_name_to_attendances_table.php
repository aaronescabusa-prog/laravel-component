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
            $table->string('full_name')->nullable()->after('student_id');
        });

        DB::table('attendances')
            ->join('registrations', 'registrations.id', '=', 'attendances.registration_id')
            ->select('attendances.id as attendance_id', 'registrations.participant as full_name')
            ->orderBy('attendances.id')
            ->chunkById(500, function ($rows) {
                foreach ($rows as $row) {
                    DB::table('attendances')
                        ->where('id', $row->attendance_id)
                        ->update(['full_name' => $row->full_name]);
                }
            }, 'attendances.id', 'attendance_id');
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropColumn('full_name');
        });
    }
};
