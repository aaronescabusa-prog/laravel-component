<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->boolean('attendance_compulsory')->default(false)->after('penalty_amount');
            $table->boolean('attendance_requires_checkout')->default(true)->after('attendance_compulsory');
            $table->decimal('absence_fine_amount', 10, 2)->nullable()->after('attendance_requires_checkout');
            $table->decimal('incomplete_fine_amount', 10, 2)->nullable()->after('absence_fine_amount');
            $table->dateTime('attendance_correction_deadline')->nullable()->after('incomplete_fine_amount');
            $table->dateTime('excuse_deadline')->nullable()->after('attendance_correction_deadline');
            $table->dateTime('attendance_roster_finalized_at')->nullable()->after('excuse_deadline');
            $table->string('target_block', 50)->nullable()->after('target_year');
        });

        Schema::table('user_accounts', function (Blueprint $table) {
            $table->string('attendance_qr_token', 64)->nullable()->unique()->after('student_id');
        });

        DB::table('user_accounts')->whereNull('attendance_qr_token')->orderBy('id')->chunkById(500, function ($accounts): void {
            foreach ($accounts as $account) {
                DB::table('user_accounts')->where('id', $account->id)->update([
                    'attendance_qr_token' => bin2hex(random_bytes(24)),
                ]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('user_accounts', function (Blueprint $table) {
            $table->dropUnique(['attendance_qr_token']);
            $table->dropColumn('attendance_qr_token');
        });

        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn([
                'attendance_compulsory', 'attendance_requires_checkout',
                'absence_fine_amount', 'incomplete_fine_amount',
                'attendance_correction_deadline', 'excuse_deadline', 'attendance_roster_finalized_at', 'target_block',
            ]);
        });
    }
};
