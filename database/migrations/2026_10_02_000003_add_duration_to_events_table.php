<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The duration is stored as a value plus its unit rather than a single
     * pre-formatted string so the length can be compared, filtered and
     * aggregated later without parsing text.
     */
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->unsignedInteger('duration_value')->nullable()->after('start_time');
            $table->string('duration_unit', 10)->nullable()->default('Hours')->after('duration_value');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn(['duration_value', 'duration_unit']);
        });
    }
};