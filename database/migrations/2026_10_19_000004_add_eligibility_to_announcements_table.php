<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('announcements', function (Blueprint $table): void {
            $table->string('target_role', 30)->nullable()->after('audience');
            $table->string('target_department', 20)->nullable()->after('target_role');
            $table->string('target_course', 120)->nullable()->after('target_department');
            $table->string('target_year', 30)->nullable()->after('target_course');
            $table->string('target_block', 50)->nullable()->after('target_year');
        });
    }

    public function down(): void
    {
        Schema::table('announcements', function (Blueprint $table): void {
            $table->dropColumn(['target_role', 'target_department', 'target_course', 'target_year', 'target_block']);
        });
    }
};
