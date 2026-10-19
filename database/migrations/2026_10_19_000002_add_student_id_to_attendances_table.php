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
            $table->string('student_id', 50)->nullable()->after('registration_id');
        });

        DB::table('attendances')
            ->join('registrations', 'registrations.id', '=', 'attendances.registration_id')
            ->join('user_accounts', 'user_accounts.id', '=', 'registrations.user_account_id')
            ->whereNotNull('user_accounts.student_id')
            ->select('attendances.id as attendance_id', 'user_accounts.student_id')
            ->orderBy('attendances.id')
            ->chunkById(500, function ($rows) {
                foreach ($rows as $row) {
                    DB::table('attendances')
                        ->where('id', $row->attendance_id)
                        ->update(['student_id' => $row->student_id]);
                }
            }, 'attendances.id', 'attendance_id');
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropColumn('student_id');
        });
    }
};
